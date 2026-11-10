#!/usr/bin/env bash
# Round ARCH (Phase 2): live check, after a deploy, that a public organization page is cached at CloudFront for
# visitors and that nothing signed-in or personal ever is. Run by .github/workflows/aws-remote-verify.yml.
# Read-only: one SELECT in a READ ONLY transaction that is rolled back (run on the bootstrap host through SSM),
# then plain HTTPS requests from here.
#
# The page probed is read from the database, never a typed slug: the organization whose name is exactly the one in
# scripts/aws/org-page-probe-name.txt (the owner's choice; Sea N Shore has no organization page of its own yet).
# Exactly one organization must have that name, and it must be claimed and verified.
#
# Checks, each on a fresh query string so earlier visits cannot answer:
#   1. signed out, /organizations/<slug> reaches "x-cache: Hit from cloudfront" with the organization header;
#   2. the cached page contains no "sns_" text (no session cookie or cookie name leaked into the HTML);
#   3. the same page with a session cookie is never a hit and never public (3 tries);
#   4. /organizations/<slug>/manage signed out is never public (3 tries).
# Evidence line (the workflow reads only this): ORG_PAGE_SIGNED_IN_AND_PERSONAL_NEVER_EDGE_CACHED_VERIFIED=true
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
ORG_HEADER='public, max-age=0, s-maxage=300, stale-while-revalidate=600'
HIT_TRIES="${ORG_PAGE_HIT_TRIES:-12}"
HIT_WAIT_SECONDS="${ORG_PAGE_HIT_WAIT_SECONDS:-10}"

SITE="$(tr -d '[:space:]' < scripts/aws/public-site-url.txt)"
[[ "$SITE" =~ ^https://([a-z0-9.-]+)$ ]] || { echo "scripts/aws/public-site-url.txt must hold one https origin." >&2; exit 1; }
PROBE_NAME="$(sed -e 's/[[:space:]]*$//' scripts/aws/org-page-probe-name.txt)"
[[ -n "$PROBE_NAME" && ${#PROBE_NAME} -le 120 && "$PROBE_NAME" != *'"'* && "$PROBE_NAME" != *'\'* ]] || { echo "scripts/aws/org-page-probe-name.txt must hold one organization name (no quotes or backslashes)." >&2; exit 1; }
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing the check." >&2; exit 1; }

# The read-only lookup runs on the bootstrap host through SSM (the host can reach the database; this runner's role
# cannot, and is not given that access). It prints only the Data API's JSON for one SELECT.
INSTANCE_IDS="$(aws ec2 describe-instances --region "$AWS_REGION" --filters "Name=tag:Name,Values=sea-n-shore-bootstrap" "Name=instance-state-name,Values=running" --query 'Reservations[].Instances[].InstanceId' --output json)"
[[ "$(jq 'length' <<<"$INSTANCE_IDS")" -eq 1 ]] || { echo "Expected exactly one running bootstrap host." >&2; exit 1; }
INSTANCE_ID="$(jq -r '.[0]' <<<"$INSTANCE_IDS")"
[[ "$INSTANCE_ID" =~ ^i-[0-9a-f]+$ ]] || { echo "Unexpected bootstrap instance id." >&2; exit 1; }

PARAMS_FILE="$(mktemp)"
RESULT_FILE="$(mktemp)"
trap 'rm -f -- "$PARAMS_FILE" "$RESULT_FILE"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
REMOTE_SCRIPT="$(printf 'set -euo pipefail\numask 077\nexport AWS_PAGER=""\nAWS_REGION=%q\nCLUSTER_ID=%q\nDATABASE_NAME=%q\nPROBE_NAME=%q\n' "$AWS_REGION" "$CLUSTER_ID" "$DATABASE_NAME" "$PROBE_NAME")
$(cat <<'REMOTE'
CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]] || { echo "Unexpected Aurora cluster; refusing the check." >&2; exit 1; }
[[ -n "$SECRET_ARN" ]] || { echo "Aurora master secret not found." >&2; exit 1; }

TX_ID="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
trap 'aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" \
  --transaction-id "$TX_ID" --sql "SET TRANSACTION READ ONLY" >/dev/null
# The name is a bound parameter; the slug and the two flags come back as data.
SLUGS_JSON="$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" \
  --transaction-id "$TX_ID" --output json \
  --parameters "[{\"name\":\"probe_name\",\"value\":{\"stringValue\":\"$PROBE_NAME\"}}]" \
  --sql "WITH candidates AS (
           SELECT slug,
                  coalesce(to_jsonb(companies) ->> 'claim_status', 'claimed') = 'claimed' AS claimed,
                  coalesce(is_verified, false) AS verified
           FROM public.companies
           WHERE btrim(name) = :probe_name
         )
         SELECT slug, claimed, verified FROM candidates
         ORDER BY slug")"
printf '%s\n' "$SLUGS_JSON"
REMOTE
)"
python3 -c 'import json, shlex, sys; print(json.dumps({"executionTimeout": ["300"], "commands": ["runuser -u ssm-user -- bash -lc " + shlex.quote(sys.stdin.read())]}))' <<<"$REMOTE_SCRIPT" > "$PARAMS_FILE"
COMMAND_ID="$(aws ssm send-command --region "$AWS_REGION" --instance-ids "$INSTANCE_ID" --document-name AWS-RunShellScript \
  --comment "Sea N Shore read-only organization page probe lookup" --timeout-seconds 300 \
  --parameters "file://$PARAMS_FILE" --query 'Command.CommandId' --output text)"
[[ "$COMMAND_ID" =~ ^[0-9a-f-]{36}$ ]] || { echo "SSM did not accept the lookup." >&2; exit 1; }
for attempt in $(seq 1 60); do
  STATUS="$(aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --query Status --output text 2>/dev/null || echo Pending)"
  case "$STATUS" in Pending|InProgress|Delayed) sleep 5 ;; *) break ;; esac
done
aws ssm get-command-invocation --region "$AWS_REGION" --command-id "$COMMAND_ID" --instance-id "$INSTANCE_ID" --output json > "$RESULT_FILE"
[[ "$(jq -r '.Status' "$RESULT_FILE")" == Success ]] || { echo "The read-only lookup on the bootstrap host did not succeed: $(jq -r '.StandardErrorContent // empty' "$RESULT_FILE" | tail -c 400)" >&2; exit 1; }
SLUGS_JSON="$(jq -r '.StandardOutputContent' "$RESULT_FILE")"
MATCHES="$(jq '.records | length' <<<"$SLUGS_JSON")"
[[ "$MATCHES" -eq 1 ]] || { echo "Expected exactly one organization named as in org-page-probe-name.txt; found $MATCHES." >&2; exit 1; }
[[ "$(jq -r '.records[0][1].booleanValue' <<<"$SLUGS_JSON")" == true ]] || { echo "The probe organization is not claimed." >&2; exit 1; }
[[ "$(jq -r '.records[0][2].booleanValue' <<<"$SLUGS_JSON")" == true ]] || { echo "The probe organization is not verified." >&2; exit 1; }
SLUG="$(jq -r '.records[0][0].stringValue // empty' <<<"$SLUGS_JSON")"
[[ "$SLUG" =~ ^[a-z0-9][a-z0-9-]*$ ]] || { echo "The organization slug is not in the expected form." >&2; exit 1; }
echo "ORG_PAGE_PROBE_SLUG=$SLUG"

page_probe() {
  # Headers only, lower-cased; the body goes to the file named in $1.
  local body="$1"; shift
  curl --silent --show-error --max-time 45 -o "$body" -D - -H 'Accept: text/html' -H 'Sec-Fetch-Dest: document' "$@" | tr -d '\r' | tr '[:upper:]' '[:lower:]'
}

PROBE="edge_probe=$(date +%s)$RANDOM"
PAGE_URL="$SITE/organizations/$SLUG?$PROBE"
BODY="$(mktemp)"
HIT=false
for attempt in $(seq 1 "$HIT_TRIES"); do
  HEADERS="$(page_probe "$BODY" "$PAGE_URL")"
  grep -q '^http/[0-9.]* 200' <<<"$HEADERS" || { echo "The organization page did not answer 200 signed out (attempt $attempt)." >&2; exit 1; }
  grep -qxF "cache-control: $ORG_HEADER" <<<"$HEADERS" || { echo "The organization page does not carry the public organization header signed out." >&2; exit 1; }
  if grep -q '^x-cache: hit from cloudfront' <<<"$HEADERS"; then HIT=true; break; fi
  sleep "$HIT_WAIT_SECONDS"
done
[[ "$HIT" == true ]] || { echo "The organization page never reached a CloudFront hit after $HIT_TRIES tries." >&2; exit 1; }
if grep -q 'sns_' "$BODY"; then echo "The cached organization page contains sns_ text." >&2; exit 1; fi
echo "ORG_PAGE_SIGNED_OUT_EDGE_HIT=true"

for attempt in 1 2 3; do
  HEADERS="$(page_probe /dev/null -H 'Cookie: sns_cognito_access=edge-probe-not-a-session' "$PAGE_URL")"
  if grep -q '^x-cache: hit from cloudfront' <<<"$HEADERS"; then echo "A request with a session cookie was answered from the CloudFront cache (attempt $attempt)." >&2; exit 1; fi
  if grep -q '^cache-control: public' <<<"$HEADERS"; then echo "A request with a session cookie was marked public (attempt $attempt)." >&2; exit 1; fi
  HEADERS="$(page_probe /dev/null "$SITE/organizations/$SLUG/manage?$PROBE")"
  if grep -q '^cache-control: public' <<<"$HEADERS"; then echo "The manage page was marked public signed out (attempt $attempt)." >&2; exit 1; fi
  if grep -q '^x-cache: hit from cloudfront' <<<"$HEADERS"; then echo "The manage page was answered from the CloudFront cache (attempt $attempt)." >&2; exit 1; fi
done
rm -f "$BODY"
echo 'ORG_PAGE_SIGNED_IN_AND_PERSONAL_NEVER_EDGE_CACHED_VERIFIED=true'

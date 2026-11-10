#!/usr/bin/env bash
# Round ARCH (Phase 2): live check, after a deploy, that a public organization page is cached at CloudFront for
# visitors and that nothing signed-in or personal ever is. Run by .github/workflows/aws-remote-verify.yml.
# Read-only: one SELECT in a READ ONLY transaction that is rolled back, then plain HTTPS requests.
#
# The page probed is Sea N Shore's own organization, read from the database, never a typed slug: the claimed,
# verified organization whose website is the public site (scripts/aws/public-site-url.txt), else the one named
# exactly "Sea N Shore". Exactly one must match.
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
SITE_HOST="${BASH_REMATCH[1]}"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]] || { echo "Unexpected AWS account; refusing the check." >&2; exit 1; }

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]] || { echo "Unexpected Aurora cluster; refusing the check." >&2; exit 1; }
[[ -n "$SECRET_ARN" ]] || { echo "Aurora master secret not found." >&2; exit 1; }

TX_ID="$(aws rds-data begin-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --query transactionId --output text)"
trap 'aws rds-data rollback-transaction --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --transaction-id "$TX_ID" >/dev/null 2>&1 || true' EXIT
aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" \
  --transaction-id "$TX_ID" --sql "SET TRANSACTION READ ONLY" >/dev/null
# The site host and the name are bound parameters; the slug comes back as data.
SLUGS_JSON="$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" \
  --transaction-id "$TX_ID" --output json \
  --parameters "[{\"name\":\"host\",\"value\":{\"stringValue\":\"$SITE_HOST\"}}]" \
  --sql "WITH candidates AS (
           SELECT slug,
                  lower(regexp_replace(regexp_replace(coalesce(website, ''), '^https?://(www\\.)?', ''), '[/:?#].*$', '')) = lower(:host) AS by_website,
                  lower(btrim(name)) = 'sea n shore' AS by_name
           FROM public.companies
           WHERE coalesce(to_jsonb(companies) ->> 'claim_status', 'claimed') = 'claimed'
             AND coalesce(is_verified, false)
         )
         SELECT slug FROM candidates
         WHERE by_website OR (by_name AND NOT EXISTS (SELECT 1 FROM candidates WHERE by_website))
         ORDER BY slug")"
mapfile -t SLUGS < <(jq -r '.records[]?[0].stringValue // empty' <<<"$SLUGS_JSON")
[[ "${#SLUGS[@]}" -eq 1 ]] || { echo "Expected exactly one Sea N Shore organization page (claimed, verified, website $SITE_HOST or named Sea N Shore); found ${#SLUGS[@]}." >&2; exit 1; }
SLUG="${SLUGS[0]}"
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

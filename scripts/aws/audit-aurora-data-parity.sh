#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
CLUSTER_ID="sea-n-shore-staging-aurora"
DATABASE_NAME="sea_n_shore"
COGNITO_POOL_ID="ap-south-1_FKyi5lJsY"

[[ "${AURORA_PARITY_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "AURORA_PARITY_EXPECTED_SHA must be an exact 40-character commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$AURORA_PARITY_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- scripts/aws scripts/migration infra/aws/database
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
HTTP_ENDPOINT="$(jq -r '.DBClusters[0].HttpEndpointEnabled // false' <<<"$CLUSTER_JSON")"
STATUS="$(jq -r '.DBClusters[0].Status // empty' <<<"$CLUSTER_JSON")"
[[ "$STATUS" == "available" ]] || { echo "Aurora is not available: $STATUS" >&2; exit 1; }
[[ "$HTTP_ENDPOINT" == "true" ]] || { echo "Aurora Data API is not enabled." >&2; exit 1; }
[[ "$CLUSTER_ARN" == arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

echo "AURORA_DATA_API_ENABLED=true"
echo "AURORA_STATUS=available"
echo "READ_ONLY_AUDIT=true"

TABLES=(profiles companies company_members maritime_profiles profile_skills posts post_reactions post_comments saved_posts post_media post_polls post_poll_options post_poll_votes follows connections user_blocks notifications identity_accounts)
RESULTS='[]'
for table in "${TABLES[@]}"; do
  case "$table" in
    profiles|companies|company_members|maritime_profiles|profile_skills|posts|post_reactions|post_comments|saved_posts|post_media|post_polls|post_poll_options|post_poll_votes|follows|connections|user_blocks|notifications|identity_accounts) ;;
    *) echo "Unexpected table in fixed allowlist: $table" >&2; exit 1 ;;
  esac
  SQL="SELECT count(*)::bigint AS row_count FROM public.${table}"
  RESPONSE="$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$SQL" --include-result-metadata --output json)"
  COUNT="$(jq -er '.records[0][0].longValue' <<<"$RESPONSE")"
  [[ "$COUNT" =~ ^[0-9]+$ ]]
  echo "AURORA_TABLE_COUNT_${table^^}=$COUNT"
  RESULTS="$(jq --arg table "$table" --argjson count "$COUNT" '. + [{table:$table,row_count:$count}]' <<<"$RESULTS")"
done
printf '%s\n' "$RESULTS" | jq -S '.'

declare -A KEY_EXPRESSIONS=(
  [profiles]='id::text' [companies]='id::text' [company_members]='company_id::text,user_id::text'
  [maritime_profiles]='user_id::text' [profile_skills]='user_id::text,skill::text' [posts]='id::text'
  [post_reactions]='post_id::text,user_id::text' [post_comments]='id::text' [saved_posts]='post_id::text,user_id::text'
  [post_media]='id::text' [post_polls]='post_id::text' [post_poll_options]='id::text'
  [post_poll_votes]='post_id::text,user_id::text' [follows]='follower_id::text,following_id::text'
  [connections]='id::text' [user_blocks]='blocker_id::text,blocked_id::text' [notifications]='id::text'
)
SOURCE_COMPATIBLE_TABLES=(profiles companies company_members maritime_profiles profile_skills posts post_reactions post_comments saved_posts post_media post_polls post_poll_options post_poll_votes follows connections user_blocks notifications)

# One line per table, never one per row: SSM keeps only the first 24,000 characters of stdout, and a line per
# row (4,900+ profiles alone) filled it, so later evidence was cut off. Each key set is printed as its row count
# and a digest computed in Aurora: md5 of every row's key hash, sorted bytewise (COLLATE "C") and joined with
# a newline (md5 of the empty string for an empty table). The same SQL on any copy of the data gives the same
# digest, so two sides still compare exactly. Keys are ids only; nothing here is personal data.
key_set() {
  local label="$1" sql="$2" response rows digest
  response="$(aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$sql" --output json)"
  rows="$(jq -er '.records[0][0].longValue' <<<"$response")"
  digest="$(jq -er '.records[0][1].stringValue' <<<"$response")"
  [[ "$rows" =~ ^[0-9]+$ ]] || { echo "Unexpected row count for $label" >&2; exit 1; }
  [[ "$digest" =~ ^[0-9a-f]{32}$ ]] || { echo "Unexpected key set digest format for $label" >&2; exit 1; }
  echo "${label}=rows:${rows}|md5:${digest}"
}
set_sql() {
  printf "SELECT count(*)::bigint AS row_count, md5(coalesce(string_agg(row_hash, chr(10) ORDER BY row_hash COLLATE \"C\"), '')) AS set_digest FROM (SELECT md5(array_to_string(array[%s], chr(31))) AS row_hash FROM public.%s) hashed" "$1" "$2"
}
for table in "${SOURCE_COMPATIBLE_TABLES[@]}"; do
  key_set "AURORA_KEY_SET_${table^^}" "$(set_sql "${KEY_EXPRESSIONS[$table]}" "$table")"
done
echo "AURORA_TARGET_KEY_INVENTORY_COMPLETE=true"

# Generated IDs/timestamps may be recreated during migration. These fingerprints
# use stable business fields only so semantic preservation can be proved without PII.
key_set AURORA_CONNECTION_BUSINESS_SET "$(set_sql "user_low_id::text,user_high_id::text,requested_by::text,status::text" connections)"
key_set AURORA_NOTIFICATION_BUSINESS_SET "$(set_sql "recipient_id::text,coalesce(actor_id::text,''),notification_type::text" notifications)"
echo "AURORA_BUSINESS_PARITY_INVENTORY_COMPLETE=true"

# PII-safe identity evidence. Raw values exist only in restrictive temporary files
# and are never emitted to GitHub Actions logs.
TMP_IDENTITY_DIR="$(mktemp -d)"
trap 'rm -rf -- "$TMP_IDENTITY_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM
aws cognito-idp list-users --region "$AWS_REGION" --user-pool-id "$COGNITO_POOL_ID" --output json > "$TMP_IDENTITY_DIR/cognito.json"
IDENTITY_SQL="SELECT ia.profile_id::text, ia.provider_subject, coalesce(ia.email, ''), coalesce(p.account_status::text, 'missing') FROM public.identity_accounts ia LEFT JOIN public.profiles p ON p.id = ia.profile_id WHERE ia.provider = 'cognito' ORDER BY ia.profile_id"
aws rds-data execute-statement --region "$AWS_REGION" --resource-arn "$CLUSTER_ARN" --secret-arn "$SECRET_ARN" --database "$DATABASE_NAME" --sql "$IDENTITY_SQL" --output json > "$TMP_IDENTITY_DIR/accounts.json"
python3 - "$TMP_IDENTITY_DIR/cognito.json" "$TMP_IDENTITY_DIR/accounts.json" <<'PY'
import collections, hashlib, json, re, sys

def token(value):
    value=(value or '').strip().lower()
    return hashlib.sha256(value.encode()).hexdigest()[:16] if value else ''

with open(sys.argv[1]) as f: cognito=json.load(f)
with open(sys.argv[2]) as f: accounts=json.load(f)

cognito_rows=[]
for user in cognito.get('Users', []):
    attrs={item.get('Name'): item.get('Value','') for item in user.get('Attributes', [])}
    subject=attrs.get('sub') or user.get('Username','')
    email=attrs.get('email','')
    if not subject or not email: raise SystemExit('Cognito user missing subject or email')
    cognito_rows.append((token(email), token(subject)))

account_rows=[]
account_status={}
for row in accounts.get('records', []):
    profile=row[0].get('stringValue','')
    subject=row[1].get('stringValue','')
    email=row[2].get('stringValue','')
    status=row[3].get('stringValue','') if len(row) > 3 else 'active'
    if not profile or not subject or not email: raise SystemExit('Aurora identity row missing profile, subject, or email')
    account_rows.append((token(email), token(profile), token(subject)))
    account_status[token(subject)]=status

# Round 15 multi-login: one person may hold several Cognito users with the same email (email + Google), each linked
# to the same profile through its own identity_accounts row; Cognito users with no profile yet (sign-up not finished)
# are counted, not failed. Real problems still fail: duplicate subjects, an Aurora identity whose Cognito user is
# missing or has another email, and one email mapped to two different profiles.
if len({x[1] for x in cognito_rows}) != len(cognito_rows): raise SystemExit('Duplicate Cognito subject token')
if len({x[2] for x in account_rows}) != len(account_rows): raise SystemExit('Duplicate Aurora provider subject token')

cognito_email_by_subject={subject_token: email_token for email_token, subject_token in cognito_rows}
profile_by_subject={subject_token: profile_token for _, profile_token, subject_token in account_rows}
# An identity whose Cognito user is gone is expected only for a profile whose deletion was requested (the account
# deletion removes the sign-in); on any other profile it fails. Counts are by profile status only.
orphans=collections.Counter(account_status[subject_token] for _, _, subject_token in account_rows if subject_token not in cognito_email_by_subject)
live_by_profile=collections.Counter(p for _, p, subject in account_rows if subject in cognito_email_by_subject)
orphan_profiles={(p, account_status[subject]) for _, p, subject in account_rows if subject not in cognito_email_by_subject}
orphan_kinds=collections.Counter(f"{status}:{'has_other_sign_in' if live_by_profile[p] else 'no_sign_in_left'}" for p, status in orphan_profiles)
summary=['AURORA_IDENTITIES_WITHOUT_COGNITO_USER=' + json.dumps(dict(sorted(orphans.items()))),
         'AURORA_PROFILES_WITH_A_MISSING_SIGN_IN=' + json.dumps(dict(sorted(orphan_kinds.items())))]
for line in summary:
    print(line)
    # Also on stderr, which SSM returns separately from stdout, so the verdict's reasons survive any stdout cut.
    print(line, file=sys.stderr)
for email_token, profile_token, subject_token in account_rows:
    if subject_token in cognito_email_by_subject and cognito_email_by_subject[subject_token] != email_token:
        raise SystemExit('Aurora identity email differs from Cognito')

profiles_by_email={}
for email_token, profile_token, _ in account_rows:
    profiles_by_email.setdefault(email_token, set()).add(profile_token)
if any(len(profiles) > 1 for profiles in profiles_by_email.values()):
    raise SystemExit('One email is mapped to several profiles')

subjects_by_email={}
for email_token, subject_token in cognito_rows:
    subjects_by_email.setdefault(email_token, []).append(subject_token)
groups={'multi_login': 0, 'multi_login_plus_unmapped': 0, 'unmapped_only': 0}
for subjects in (s for s in subjects_by_email.values() if len(s) > 1):
    mapped=[subject for subject in subjects if subject in profile_by_subject]
    if not mapped: groups['unmapped_only'] += 1
    elif len(mapped) == len(subjects): groups['multi_login'] += 1
    else: groups['multi_login_plus_unmapped'] += 1
unmapped=sum(1 for _, subject_token in cognito_rows if subject_token not in profile_by_subject)
profiles_with_several=sum(1 for n in collections.Counter(p for _, p, _ in account_rows).values() if n > 1)
for line in ['COGNITO_DUPLICATE_EMAIL_GROUPS=' + json.dumps(groups, sort_keys=True), f'COGNITO_UNMAPPED_USERS={unmapped}',
             f'AURORA_PROFILES_WITH_SEVERAL_IDENTITIES={profiles_with_several}']:
    print(line)
    print(line, file=sys.stderr)
# Refuse only after every summary line is out, so a failing run still answers what it found.
if any(status != 'deletion_requested' for status in orphans):
    raise SystemExit('Aurora identity has no Cognito user (profile not deleted)')

print(f'COGNITO_USER_COUNT={len(cognito_rows)}')
print(f'AURORA_IDENTITY_COUNT={len(account_rows)}')
cognito_pairs={(email_token, subject_token) for email_token, subject_token in cognito_rows}
provider_pairs={(email_token, subject_token) for email_token, _, subject_token in account_rows if subject_token in cognito_email_by_subject}
if not provider_pairs <= cognito_pairs:
    raise SystemExit('Cognito and Aurora provider identity mappings differ')
for email_token, subject_token in cognito_rows:
    if not re.fullmatch(r'[0-9a-f]{16}', email_token + '') or not re.fullmatch(r'[0-9a-f]{16}', subject_token + ''):
        raise SystemExit('Bad Cognito token')
for email_token, profile_token, subject_token in account_rows:
    if not all(re.fullmatch(r'[0-9a-f]{16}', value) for value in (email_token, profile_token, subject_token)):
        raise SystemExit('Bad Aurora identity token')

def token_set(lines):
    # One line per set, not per identity (stdout stays small, and no per-person email hash is printed):
    # row count and md5 of the sorted lines joined with a newline.
    return f"rows:{len(lines)}|md5:{hashlib.md5(chr(10).join(sorted(lines)).encode()).hexdigest()}"

print('COGNITO_IDENTITY_TOKEN_SET=' + token_set([f'{e}|{s}' for e, s in cognito_rows]))
print('AURORA_PROVIDER_IDENTITY_TOKEN_SET=' + token_set([f'{e}|{s}' for e, _, s in account_rows]))
print('AURORA_PROFILE_IDENTITY_TOKEN_SET=' + token_set([f'{p}|{e}' for e, p, _ in account_rows]))
print('AWS_IDENTITY_MAPPING_MATCH=true')
PY

echo "AWS_IDENTITY_INVENTORY_COMPLETE=true"
echo "AURORA_TARGET_INVENTORY_COMPLETE=true"

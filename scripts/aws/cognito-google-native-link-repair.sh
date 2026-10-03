#!/usr/bin/env bash
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
ACTION_FILE="scripts/aws/cognito-google-native-link-repair-action.txt"
DATABASE_NAME="sea_n_shore"
CLUSTER_ID="sea-n-shore-staging-aurora"

[[ "${COGNITO_GOOGLE_NATIVE_LINK_REPAIR_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "COGNITO_GOOGLE_NATIVE_LINK_REPAIR_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$COGNITO_GOOGLE_NATIVE_LINK_REPAIR_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  scripts/aws/cognito-google-native-link-repair.sh \
  scripts/aws/cognito-google-native-link-repair-action.txt \
  scripts/aws/cognito-google-native-link-repair.test.mjs \
  .github/workflows/aws-cognito-google-native-link-repair.yml

[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in
  plan|repair-once|send-reset-once) ;;
  *) echo "Unsupported Cognito Google/native repair action." >&2; exit 1 ;;
esac

WORK_DIR="$(mktemp -d /var/tmp/sea-n-shore-cognito-link-repair.XXXXXXXX)"
trap 'rm -rf -- "$WORK_DIR"' EXIT

aws s3api get-object \
  --bucket "$STATE_BUCKET" \
  --key "$STATE_KEY" \
  --region "$AWS_REGION" \
  "$WORK_DIR/state.json" >/dev/null

USER_POOL_ID="$(jq -r '
  [.resources[]
   | select(.mode=="managed" and .type=="aws_cognito_user_pool" and .name=="app")
   | .instances[0].attributes.id][0] // empty
' "$WORK_DIR/state.json")"
CLIENT_ID="$(jq -r '
  [.resources[]
   | select(.mode=="managed" and .type=="aws_cognito_user_pool_client" and .name=="web")
   | .instances[0].attributes.id][0] // empty
' "$WORK_DIR/state.json")"
[[ "$USER_POOL_ID" == ap-south-1_* ]]
[[ "$CLIENT_ID" =~ ^[a-z0-9]+$ ]]

CLUSTER_JSON="$(aws rds describe-db-clusters \
  --region "$AWS_REGION" \
  --db-cluster-identifier "$CLUSTER_ID" \
  --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

aws cognito-idp list-users \
  --region "$AWS_REGION" \
  --user-pool-id "$USER_POOL_ID" \
  --output json > "$WORK_DIR/users.json"

python3 - \
  "$WORK_DIR/users.json" \
  "$ACTION" \
  "$USER_POOL_ID" \
  "$AWS_REGION" \
  "$CLUSTER_ARN" \
  "$SECRET_ARN" \
  "$DATABASE_NAME" \
  "$CLIENT_ID" <<'PY'
import hashlib
import json
import re
import subprocess
import sys
from collections import defaultdict

users_path, action, user_pool_id, region, cluster_arn, secret_arn, database, client_id = sys.argv[1:]

with open(users_path, encoding='utf-8') as handle:
    users = json.load(handle).get('Users', [])

def attrs(user):
    return {
        item.get('Name'): item.get('Value')
        for item in (user.get('Attributes') or [])
        if item.get('Name')
    }

def identities(attributes):
    raw = attributes.get('identities')
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return []
    return value if isinstance(value, list) else []

def normalized_email(attributes):
    raw = attributes.get('email')
    if not isinstance(raw, str):
        return None
    value = raw.strip().lower()
    if not re.fullmatch(r'[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+', value):
        return None
    return value

def run_json(label, args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f'{label}_failed')
    try:
        return json.loads(result.stdout or '{}')
    except json.JSONDecodeError as error:
        raise SystemExit(f'{label}_invalid_json') from error

groups = defaultdict(list)
for user in users:
    user_attrs = attrs(user)
    email = normalized_email(user_attrs)
    if email:
        groups[email].append((user, user_attrs))

duplicate_groups = 0
strict_candidates = []
skipped = 0

for email, entries in groups.items():
    if len(entries) < 2:
        continue
    duplicate_groups += 1

    native = []
    google = []
    for user, user_attrs in entries:
        ids = identities(user_attrs)
        google_ids = [
            item for item in ids
            if isinstance(item, dict)
            and item.get('providerName') == 'Google'
            and isinstance(item.get('userId'), str)
            and item.get('userId')
        ]
        if (
            user.get('Enabled') is not False
            and user.get('UserStatus') != 'EXTERNAL_PROVIDER'
            and user_attrs.get('email_verified') == 'true'
        ):
            native.append((user, user_attrs))
        if (
            user.get('Enabled') is not False
            and user.get('UserStatus') == 'EXTERNAL_PROVIDER'
            and user_attrs.get('email_verified') == 'true'
            and len(google_ids) == 1
        ):
            google.append((user, user_attrs, google_ids[0]))

    if len(entries) != 2 or len(native) != 1 or len(google) != 1:
        skipped += 1
        continue

    native_user, native_attrs = native[0]
    google_user, google_attrs, google_identity = google[0]
    native_username = native_user.get('Username')
    google_username = google_user.get('Username')
    native_sub = native_attrs.get('sub')
    google_sub = google_attrs.get('sub')
    provider_subject = google_identity.get('userId')

    if not all(isinstance(value, str) and value for value in (
        native_username, google_username, native_sub, google_sub, provider_subject
    )):
        skipped += 1
        continue

    strict_candidates.append({
        'email': email,
        'email_hash': hashlib.sha256(email.encode()).hexdigest()[:12],
        'native_username': native_username,
        'native_sub': native_sub,
        'google_username': google_username,
        'google_sub': google_sub,
        'provider_subject': provider_subject,
    })

linked_native_users = []
for user in users:
    user_attrs = attrs(user)
    ids = identities(user_attrs)
    if (
        user.get('UserStatus') != 'EXTERNAL_PROVIDER'
        and user.get('Enabled') is not False
        and user_attrs.get('email_verified') == 'true'
        and any(
            isinstance(item, dict) and item.get('providerName') == 'Google'
            for item in ids
        )
    ):
        linked_native_users.append((user, user_attrs))

email_resolution_ok = 0
email_resolution_mismatch = 0
linked_confirmed = 0
for user, user_attrs in linked_native_users:
    if user.get('UserStatus') == 'CONFIRMED':
        linked_confirmed += 1
    email = normalized_email(user_attrs)
    username = user.get('Username')
    if not email or not isinstance(username, str) or not username:
        email_resolution_mismatch += 1
        continue
    result = subprocess.run([
        'aws', 'cognito-idp', 'admin-get-user',
        '--region', region,
        '--user-pool-id', user_pool_id,
        '--username', email,
        '--output', 'json',
    ], capture_output=True, text=True)
    if result.returncode != 0:
        email_resolution_mismatch += 1
        continue
    try:
        resolved = json.loads(result.stdout or '{}').get('Username')
    except json.JSONDecodeError:
        email_resolution_mismatch += 1
        continue
    if resolved == username:
        email_resolution_ok += 1
    else:
        email_resolution_mismatch += 1

historically_repaired_targets = []
for user, user_attrs in linked_native_users:
    native_sub = user_attrs.get('sub')
    email = normalized_email(user_attrs)
    username = user.get('Username')
    if not all(isinstance(value, str) and value for value in (native_sub, email, username)):
        continue

    response = run_json('linked_profile_identity_count', [
        'aws', 'rds-data', 'execute-statement',
        '--region', region,
        '--resource-arn', cluster_arn,
        '--secret-arn', secret_arn,
        '--database', database,
        '--sql',
        """select p.id::text as profile_id,
                  (p.onboarding_completed_at is not null) as completed,
                  p.account_status::text as account_status,
                  count(all_ids.id)::int as cognito_identity_count
             from public.identity_accounts native
             join public.profiles p on p.id = native.profile_id
             join public.identity_accounts all_ids
               on all_ids.profile_id = native.profile_id
              and all_ids.provider = 'cognito'
            where native.provider = 'cognito'
              and native.provider_subject = :native_sub
            group by p.id, p.onboarding_completed_at, p.account_status""",
        '--parameters', json.dumps([
            {'name': 'native_sub', 'value': {'stringValue': native_sub}},
        ]),
        '--format-records-as', 'JSON',
        '--output', 'json',
    ])

    try:
        rows = json.loads(response.get('formattedRecords') or '[]')
    except json.JSONDecodeError:
        rows = []

    if (
        len(rows) == 1
        and rows[0].get('completed') is True
        and rows[0].get('account_status') in ('active', 'restricted')
        and isinstance(rows[0].get('cognito_identity_count'), int)
        and rows[0].get('cognito_identity_count') > 1
    ):
        historically_repaired_targets.append({
            'email': email,
            'username': username,
            'native_sub': native_sub,
        })

print(f'COGNITO_GOOGLE_LINKED_NATIVE_USERS={len(linked_native_users)}')
print(f'COGNITO_GOOGLE_LINKED_NATIVE_CONFIRMED={linked_confirmed}')
print(f'COGNITO_GOOGLE_LINKED_EMAIL_RESOLUTION_OK={email_resolution_ok}')
print(f'COGNITO_GOOGLE_LINKED_EMAIL_RESOLUTION_MISMATCH={email_resolution_mismatch}')
print(f'COGNITO_GOOGLE_HISTORICAL_REPAIR_TARGETS={len(historically_repaired_targets)}')

print(f'COGNITO_GOOGLE_NATIVE_REPAIR_TOTAL_USERS={len(users)}')
print(f'COGNITO_GOOGLE_NATIVE_REPAIR_DUPLICATE_EMAIL_GROUPS={duplicate_groups}')
print(f'COGNITO_GOOGLE_NATIVE_REPAIR_STRICT_CANDIDATES={len(strict_candidates)}')
print(f'COGNITO_GOOGLE_NATIVE_REPAIR_SKIPPED_GROUPS={skipped}')

db_verified = []

for candidate in strict_candidates:
    parameters = json.dumps([
        {'name': 'native_sub', 'value': {'stringValue': candidate['native_sub']}},
        {'name': 'google_sub', 'value': {'stringValue': candidate['google_sub']}},
    ])
    response = run_json('identity_lookup', [
        'aws', 'rds-data', 'execute-statement',
        '--region', region,
        '--resource-arn', cluster_arn,
        '--secret-arn', secret_arn,
        '--database', database,
        '--sql',
        """select ia.provider_subject,
                  ia.profile_id::text as profile_id,
                  (p.onboarding_completed_at is not null) as completed,
                  p.account_status::text as account_status
             from public.identity_accounts ia
             join public.profiles p on p.id = ia.profile_id
            where ia.provider = 'cognito'
              and ia.provider_subject in (:native_sub, :google_sub)
            order by ia.provider_subject""",
        '--parameters', parameters,
        '--format-records-as', 'JSON',
        '--output', 'json',
    ])

    try:
        rows = json.loads(response.get('formattedRecords') or '[]')
    except json.JSONDecodeError:
        rows = []

    native_rows = [row for row in rows if row.get('provider_subject') == candidate['native_sub']]
    google_rows = [row for row in rows if row.get('provider_subject') == candidate['google_sub']]

    safe = (
        len(native_rows) == 1
        and native_rows[0].get('completed') is True
        and native_rows[0].get('account_status') in ('active', 'restricted')
        and len(google_rows) <= 1
    )

    if safe and google_rows:
        google_row = google_rows[0]
        safe = (
            google_row.get('profile_id') == native_rows[0].get('profile_id')
            or (
                google_row.get('completed') is False
                and google_row.get('account_status') in ('active', 'restricted')
            )
        )

    if safe:
        db_verified.append(candidate)

print(f'COGNITO_GOOGLE_NATIVE_REPAIR_DB_VERIFIED_CANDIDATES={len(db_verified)}')
print(
    'COGNITO_GOOGLE_NATIVE_REPAIR_UNSAFE_CANDIDATES='
    f'{len(strict_candidates) - len(db_verified)}'
)

if action == 'plan':
    print('COGNITO_GOOGLE_NATIVE_REPAIR_PLAN_ONLY_NO_APPLY=true')
    raise SystemExit(0)

if action == 'send-reset-once':
    if len(historically_repaired_targets) != 1:
        raise SystemExit('historical_repair_target_not_unique')

    target = historically_repaired_targets[0]
    response = run_json('forgot_password', [
        'aws', 'cognito-idp', 'forgot-password',
        '--region', region,
        '--client-id', client_id,
        '--username', target['email'],
        '--output', 'json',
    ])
    details = response.get('CodeDeliveryDetails') or {}
    medium = details.get('DeliveryMedium')
    attribute = details.get('AttributeName')
    if medium != 'EMAIL' or attribute != 'email':
        raise SystemExit('unexpected_recovery_delivery')
    print('COGNITO_GOOGLE_HISTORICAL_RESET_DELIVERY_MEDIUM=EMAIL')
    print('COGNITO_GOOGLE_HISTORICAL_RESET_ATTRIBUTE=email')
    print('COGNITO_GOOGLE_HISTORICAL_RESET_SENT=true')
    raise SystemExit(0)

if len(db_verified) != len(strict_candidates):
    raise SystemExit('unsafe_candidate_refused')

for candidate in db_verified:
    run_json('delete_external_user', [
        'aws', 'cognito-idp', 'admin-delete-user',
        '--region', region,
        '--user-pool-id', user_pool_id,
        '--username', candidate['google_username'],
        '--output', 'json',
    ])

    run_json('link_provider_user', [
        'aws', 'cognito-idp', 'admin-link-provider-for-user',
        '--region', region,
        '--user-pool-id', user_pool_id,
        '--destination-user',
        f"ProviderName=Cognito,ProviderAttributeValue={candidate['native_username']}",
        '--source-user',
        (
            'ProviderName=Google,'
            'ProviderAttributeName=Cognito_Subject,'
            f"ProviderAttributeValue={candidate['provider_subject']}"
        ),
        '--output', 'json',
    ])

    destination = run_json('verify_link', [
        'aws', 'cognito-idp', 'admin-get-user',
        '--region', region,
        '--user-pool-id', user_pool_id,
        '--username', candidate['native_username'],
        '--output', 'json',
    ])
    destination_attrs = {
        item.get('Name'): item.get('Value')
        for item in (destination.get('UserAttributes') or [])
        if item.get('Name')
    }
    linked = identities(destination_attrs)
    if not any(
        isinstance(item, dict)
        and item.get('providerName') == 'Google'
        and item.get('userId') == candidate['provider_subject']
        for item in linked
    ):
        raise SystemExit('linked_identity_verification_failed')

print(f'COGNITO_GOOGLE_NATIVE_REPAIR_APPLIED={len(db_verified)}')
print('COGNITO_GOOGLE_NATIVE_REPAIR_APPLY_VERIFIED=true')
PY

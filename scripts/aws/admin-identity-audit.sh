#!/usr/bin/env bash
# Read-only audit of members with several Cognito sign-ins (Round 15, part A). Changes nothing.
# Prints counts, kinds, statuses and dates only: never an email address or a phone number.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
ACTION_FILE="scripts/aws/admin-identity-audit-action.txt"
DATABASE_NAME="sea_n_shore"
CLUSTER_ID="sea-n-shore-staging-aurora"
# The member whose Admin → Users row was listed three times (profile username).
FOCUS_SLUG="aditya"

[[ "${ADMIN_IDENTITY_AUDIT_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "ADMIN_IDENTITY_AUDIT_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$ADMIN_IDENTITY_AUDIT_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  scripts/aws/admin-identity-audit.sh \
  scripts/aws/admin-identity-audit-action.txt \
  scripts/aws/admin-identity-audit.test.mjs \
  .github/workflows/aws-admin-identity-audit.yml

[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in
  plan) echo "ADMIN_IDENTITY_AUDIT_SKIPPED=true"; exit 0 ;;
  audit-once) ;;
  *) echo "Unsupported admin identity audit action." >&2; exit 1 ;;
esac

WORK_DIR="$(mktemp -d /var/tmp/sea-n-shore-admin-identity-audit.XXXXXXXX)"
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" >/dev/null
USER_POOL_ID="$(jq -r '
  [.resources[]
   | select(.mode=="managed" and .type=="aws_cognito_user_pool" and .name=="app")
   | .instances[0].attributes.id][0] // empty
' "$WORK_DIR/state.json")"
rm -f -- "$WORK_DIR/state.json"
[[ "$USER_POOL_ID" == ap-south-1_* ]]

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

# The CLI pages through every user.
aws cognito-idp list-users --region "$AWS_REGION" --user-pool-id "$USER_POOL_ID" --output json > "$WORK_DIR/users.json"

python3 - "$WORK_DIR/users.json" "$AWS_REGION" "$CLUSTER_ARN" "$SECRET_ARN" "$DATABASE_NAME" "$FOCUS_SLUG" <<'PY'
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict

users_path, region, cluster_arn, secret_arn, database, focus_slug = sys.argv[1:]
PHONE_LOGIN_EMAIL = re.compile(r'^phone-[0-9a-f]{32}@auth\.seaandshore\.in$', re.I)

with open(users_path, encoding='utf-8') as handle:
    users = json.load(handle).get('Users', [])

def attrs(user):
    return {item.get('Name'): item.get('Value') for item in (user.get('Attributes') or []) if item.get('Name')}

def digest(value):
    # Only to compare two addresses; never printed.
    return hashlib.sha256(value.strip().lower().encode()).hexdigest() if isinstance(value, str) and value.strip() else None

def kind(username, email):
    if isinstance(username, str) and username.lower().startswith('google_'):
        return 'google'
    if isinstance(email, str) and PHONE_LOGIN_EMAIL.match(email.strip()):
        return 'phone'
    return 'email'

def day(value):
    return str(value or '')[:10] or 'unknown'

def sql(label, statement, parameters=None):
    args = [
        'aws', 'rds-data', 'execute-statement',
        '--region', region, '--resource-arn', cluster_arn, '--secret-arn', secret_arn,
        '--database', database, '--sql', statement,
        '--format-records-as', 'JSON', '--output', 'json',
    ]
    if parameters:
        args += ['--parameters', json.dumps(parameters)]
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f'{label}_failed')
    try:
        return json.loads(json.loads(result.stdout or '{}').get('formattedRecords') or '[]')
    except json.JSONDecodeError as error:
        raise SystemExit(f'{label}_invalid_json') from error

identity_rows = sql('identity_rows', """
  select ia.profile_id::text as profile_id,
         ia.provider_subject as subject,
         ia.provider_username as username,
         ia.email as email,
         ia.email_verified as email_verified,
         (ia.phone_number is not null) as has_phone,
         ia.created_at::text as created_at,
         p.account_status::text as account_status,
         p.slug as slug
    from public.identity_accounts ia
    join public.profiles p on p.id = ia.profile_id
   where ia.provider = 'cognito'
""")

cognito_by_sub = {}
for user in users:
    user_attrs = attrs(user)
    sub = user_attrs.get('sub')
    if isinstance(sub, str) and sub:
        cognito_by_sub[sub] = (user, user_attrs)

by_profile = defaultdict(list)
for row in identity_rows:
    by_profile[row['profile_id']].append(row)

multi = {pid: rows for pid, rows in by_profile.items() if len(rows) > 1}
print(f'ADMIN_IDENTITY_AUDIT_COGNITO_USERS={len(users)}')
print(f'ADMIN_IDENTITY_AUDIT_IDENTITY_ROWS={len(identity_rows)}')
print(f'ADMIN_IDENTITY_AUDIT_PROFILES_WITH_SIGN_INS={len(by_profile)}')
print(f'ADMIN_IDENTITY_AUDIT_PROFILES_WITH_SEVERAL_SIGN_INS={len(multi)}')
print('ADMIN_IDENTITY_AUDIT_SIGN_IN_COUNT_DISTRIBUTION=' + json.dumps(dict(sorted(Counter(len(rows) for rows in by_profile.values()).items()))))
combos = Counter('+'.join(sorted(kind(r['username'], r['email']) for r in rows)) for rows in multi.values())
print('ADMIN_IDENTITY_AUDIT_SEVERAL_SIGN_IN_KINDS=' + json.dumps(dict(combos)))

# The member listed three times: what each sign-in is, without addresses.
focus = [rows for rows in by_profile.values() if rows and rows[0].get('slug') == focus_slug]
if focus:
    rows = sorted(focus[0], key=lambda r: r['created_at'])
    first_email = digest(rows[0]['email'])
    print(f'ADMIN_IDENTITY_AUDIT_FOCUS_SIGN_INS={len(rows)}')
    for index, row in enumerate(rows, 1):
        user, user_attrs = cognito_by_sub.get(row['subject'], (None, {}))
        linked = user_attrs.get('identities')
        linked_providers = []
        if linked:
            try:
                linked_providers = sorted({item.get('providerName') for item in json.loads(linked) if item.get('providerName')})
            except (json.JSONDecodeError, AttributeError):
                linked_providers = ['unreadable']
        print('ADMIN_IDENTITY_AUDIT_FOCUS_SIGN_IN=' + json.dumps({
            'n': index,
            'kind': kind(row['username'], row['email']),
            'created': day(row['created_at']),
            'email_verified': bool(row['email_verified']),
            'same_email_as_first': digest(row['email']) == first_email,
            'has_phone': bool(row['has_phone']),
            'cognito_status': (user or {}).get('UserStatus', 'missing'),
            'cognito_enabled': (user or {}).get('Enabled'),
            'cognito_created': day((user or {}).get('UserCreateDate')),
            'links_federated_identity': linked_providers,
        }, sort_keys=True))
else:
    print('ADMIN_IDENTITY_AUDIT_FOCUS_SIGN_INS=0')

# Before this fix, suspending reached one sign-in: other enabled Cognito users of suspended members.
suspended = {pid: rows for pid, rows in by_profile.items() if rows[0]['account_status'] == 'suspended'}
suspended_with_enabled_other = 0
for pid, rows in suspended.items():
    enabled = sum(1 for r in rows if (cognito_by_sub.get(r['subject'], ({}, {}))[0] or {}).get('Enabled') is True)
    if enabled:
        suspended_with_enabled_other += 1
        print('ADMIN_IDENTITY_AUDIT_SUSPENDED_MEMBER_ENABLED_SIGN_INS=' + json.dumps({'profile': pid[:8], 'sign_ins': len(rows), 'enabled_in_cognito': enabled}))
print(f'ADMIN_IDENTITY_AUDIT_SUSPENDED_MEMBERS={len(suspended)}')
print(f'ADMIN_IDENTITY_AUDIT_SUSPENDED_MEMBERS_WITH_ENABLED_SIGN_INS={suspended_with_enabled_other}')

deleted_profiles = sql('deleted_profiles', "select count(*)::int as n from public.profiles where account_status = 'deletion_requested'")
print(f'ADMIN_IDENTITY_AUDIT_DELETED_PROFILES={deleted_profiles[0]["n"] if deleted_profiles else 0}')

# Cognito users with no profile mapping: never-finished sign-ups, or logins left behind by a deletion.
mapped = {row['subject'] for row in identity_rows}
orphans = [(user, user_attrs) for sub, (user, user_attrs) in cognito_by_sub.items() if sub not in mapped]
orphan_kinds = Counter((kind(user.get('Username'), user_attrs.get('email')), user.get('UserStatus'), bool(user.get('Enabled'))) for user, user_attrs in orphans)
print(f'ADMIN_IDENTITY_AUDIT_UNMAPPED_COGNITO_USERS={len(orphans)}')
for (k, status, enabled), count in sorted(orphan_kinds.items()):
    print('ADMIN_IDENTITY_AUDIT_UNMAPPED=' + json.dumps({'kind': k, 'status': status, 'enabled': enabled, 'count': count}, sort_keys=True))
# Confirmed or federated logins without a profile could sign in again and get a fresh profile.
risky = [(u, a) for u, a in orphans if u.get('UserStatus') in ('CONFIRMED', 'EXTERNAL_PROVIDER') and u.get('Enabled')]
print(f'ADMIN_IDENTITY_AUDIT_UNMAPPED_SIGNABLE_USERS={len(risky)}')
for user, user_attrs in sorted(risky, key=lambda item: str(item[0].get('UserCreateDate'))):
    print('ADMIN_IDENTITY_AUDIT_UNMAPPED_SIGNABLE=' + json.dumps({
        'kind': kind(user.get('Username'), user_attrs.get('email')),
        'status': user.get('UserStatus'),
        'created': day(user.get('UserCreateDate')),
        'modified': day(user.get('UserLastModifiedDate')),
        'e2e': str(user_attrs.get('email') or '').startswith('sea-n-shore-e2e-'),
    }, sort_keys=True))

# Phone-only Cognito users (a mobile number and no real email). Listed, never deleted.
phone_only = []
for sub, (user, user_attrs) in cognito_by_sub.items():
    email = user_attrs.get('email')
    if user_attrs.get('phone_number') and (not email or PHONE_LOGIN_EMAIL.match(str(email).strip())):
        phone_only.append((sub, user, user_attrs))
print(f'ADMIN_IDENTITY_AUDIT_PHONE_ONLY_USERS={len(phone_only)}')
for sub, user, user_attrs in sorted(phone_only, key=lambda item: str(item[1].get('UserCreateDate'))):
    print('ADMIN_IDENTITY_AUDIT_PHONE_ONLY=' + json.dumps({
        'sub': sub[:8],
        'status': user.get('UserStatus'),
        'enabled': user.get('Enabled'),
        'phone_verified': user_attrs.get('phone_number_verified') == 'true',
        'created': day(user.get('UserCreateDate')),
        'has_profile': sub in mapped,
    }, sort_keys=True))

print('ADMIN_IDENTITY_AUDIT_READ_ONLY_VERIFIED=true')
PY

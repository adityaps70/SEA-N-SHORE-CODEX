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

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
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

python3 - "$WORK_DIR/users.json" "$AWS_REGION" "$CLUSTER_ARN" "$SECRET_ARN" "$DATABASE_NAME" "$FOCUS_SLUG" "$USER_POOL_ID" <<'PY'
import hashlib
import json
import re
import subprocess
import sys
from collections import Counter, defaultdict

users_path, region, cluster_arn, secret_arn, database, focus_slug, pool_id = sys.argv[1:]
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

# Round 16 follow-up: non-test Cognito users with no profile. For each, the step it reached and any
# web-log error around its sign-up or sign-in, to tell an abandoned sign-up from a provisioning bug.
# The profile is only created when a signed-in user first reaches the app (/auth/post-sign-in), and an
# email confirmation does not sign anyone in. Logs carry no user id, so errors are matched by time.
ANY_E2E_EMAIL = re.compile(r'^sea-n-shore-(?:[a-z-]+-)?e2e-', re.I)
TEST_DOMAINS = {'example.com', 'example.org', 'example.net', 'example.invalid'}
PUBLIC_DOMAINS = {'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'yahoo.in', 'icloud.com', 'rediffmail.com', 'proton.me', 'protonmail.com'}
WEB_LOG_GROUP = '/ecs/sea-n-shore-staging/web'
WEB_ERROR_PATTERN = '?"routing failed" ?"cognito_issue" ?"cognito_mfa_issue" ?"IdentityMapping" ?"auth_email" ?"auth_callback" ?"Error:"'
MASKS = [(re.compile(r'[^\s"\'<>@]+@[^\s"\'<>]+'), '<address>'),
         (re.compile(r'[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}', re.I), '<uuid>'),
         (re.compile(r'\b[0-9a-f]{24,}\b', re.I), '<hex>'),
         (re.compile(r'\+\d{8,15}\b|\b\d{10,15}\b'), '<number>'),
         (re.compile(r'eyJ[\w-]+\.[\w-]+\.?[\w-]*'), '<token>')]
from datetime import datetime, timedelta, timezone

def domain_class(address):
    domain = str(address or '').rsplit('@', 1)[-1].strip().lower()
    if not domain or '@' not in str(address or ''):
        return 'none'
    if domain in TEST_DOMAINS or domain.endswith('.test') or domain.endswith('.invalid'):
        return 'test'
    if domain == 'auth.seaandshore.in':
        return 'phone-login'
    return 'public-provider' if domain in PUBLIC_DOMAINS else 'other'

def when(value):
    try:
        moment = value if isinstance(value, datetime) else datetime.fromisoformat(str(value))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)

def masked(text):
    text = str(text or '').replace('\n', ' ')
    for pattern, replacement in MASKS:
        text = pattern.sub(replacement, text)
    return text[:240]

def web_errors(start, end, max_items=300):
    args = ['aws', 'logs', 'filter-log-events', '--region', region, '--log-group-name', WEB_LOG_GROUP,
            '--start-time', str(int(start.timestamp() * 1000)), '--end-time', str(int(end.timestamp() * 1000)),
            '--filter-pattern', WEB_ERROR_PATTERN, '--max-items', str(max_items), '--output', 'json']
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        return None
    events = json.loads(result.stdout or '{}').get('events', [])
    return [(datetime.fromtimestamp(e['timestamp'] / 1000, timezone.utc), masked(e.get('message'))) for e in events]

def auth_events(username):
    # Needs Cognito threat protection; reported as unavailable otherwise.
    result = subprocess.run(['aws', 'cognito-idp', 'admin-list-user-auth-events', '--region', region,
                             '--user-pool-id', pool_id, '--username', username, '--max-results', '10', '--output', 'json'],
                            capture_output=True, text=True)
    if result.returncode != 0:
        return 'unavailable'
    return [{'type': e.get('EventType'), 'response': e.get('EventResponse'), 'at': str(e.get('CreationDate'))[:16]}
            for e in json.loads(result.stdout or '{}').get('AuthEvents', [])]

STEP_LEGEND = {
    'code_not_entered': 'signed up; email code never entered',
    'code_not_entered_24h': 'signed up; email code never entered; older than 24 h, so the daily cleanup should have removed it',
    'google_no_profile': 'Google sign-in finished at Cognito; the app never created the profile',
    'confirmed_no_sign_in': 'email confirmed; no sign-in ever reached the app',
    'admin_created': 'created by an admin or import; temporary password never changed',
    'phone_verified': 'mobile sign-up (retired flow); number verified',
    'phone_unverified': 'mobile sign-up (retired flow); number never verified',
}

def step(user, user_attrs, age_hours):
    status = user.get('UserStatus')
    phone_login = kind(user.get('Username'), user_attrs.get('email')) == 'phone'
    if phone_login:
        return 'phone_verified' if user_attrs.get('phone_number_verified') == 'true' else 'phone_unverified'
    if status == 'UNCONFIRMED':
        return 'code_not_entered' if age_hours < 24 else 'code_not_entered_24h'
    if status == 'EXTERNAL_PROVIDER':
        return 'google_no_profile'
    if status == 'CONFIRMED':
        return 'confirmed_no_sign_in'
    if status == 'FORCE_CHANGE_PASSWORD':
        return 'admin_created'
    return f'status_{status}'

now = datetime.now(timezone.utc)
no_profile = []
for sub, (user, user_attrs) in cognito_by_sub.items():
    address = str(user_attrs.get('email') or '')
    if sub in mapped or ANY_E2E_EMAIL.match(address):
        continue
    no_profile.append((sub, user, user_attrs))
real = [item for item in no_profile if domain_class(item[2].get('email')) != 'test']
# Reconciles with the identity cleanup's NON_E2E_UNMAPPED_KEPT, which only treats onboarding E2E addresses as tests.
ONBOARDING_E2E_EMAIL = re.compile(r'^sea-n-shore-e2e-[0-9]+-(seafarer|shore|recruiter|trainer|student|family|enthusiast|other)@example\.com$')
cleanup_view = [(u, a) for sub, (u, a) in cognito_by_sub.items() if sub not in mapped and not ONBOARDING_E2E_EMAIL.match(str(a.get('email') or '').strip().lower())]
other_e2e = Counter(re.sub(r'-?[0-9]+.*$', '', ANY_E2E_EMAIL.sub('', str(a.get('email') or '')).split('@')[0]) or 'suite'
                    for u, a in cleanup_view if ANY_E2E_EMAIL.match(str(a.get('email') or '')))
print(f'ADMIN_IDENTITY_AUDIT_NO_PROFILE_AS_CLEANUP_COUNTS={len(cleanup_view)}')
print('ADMIN_IDENTITY_AUDIT_NO_PROFILE_OTHER_E2E=' + json.dumps(dict(other_e2e), sort_keys=True))
print(f'ADMIN_IDENTITY_AUDIT_NO_PROFILE_NON_E2E={len(no_profile)}')
print(f'ADMIN_IDENTITY_AUDIT_NO_PROFILE_TEST_DOMAIN={len(no_profile) - len(real)}')
print(f'ADMIN_IDENTITY_AUDIT_NO_PROFILE_REAL={len(real)}')
# SSM keeps only the first 24,000 characters of output, so: daily totals first, then one compact
# line per user with error counts by category, then a few distinct (masked) sample lines.
def category(line):
    m = re.search(r"routing failed \{ name: '(\w+)'", line)
    if 'Post-sign-in session routing failed' in line:
        return 'session_fail:' + (m.group(1) if m else 'unknown')
    if 'Post-sign-in profile routing failed' in line:
        return 'profile_fail'
    if 'Failed to find Server Action' in line:
        return 'stale_action'
    m = re.search(r"\[(cognito_issue|cognito_mfa_issue)\] \{ operation: '(\w+)', reason: '(\w+)'", line)
    if m:
        return ('cognito:' if m.group(1) == 'cognito_issue' else 'mfa:') + m.group(2) + ':' + m.group(3)
    m = re.search(r"\[auth_email_limited\] \{ action: '(\w+)'", line)
    if m:
        return 'email_limited:' + m.group(1)
    m = re.search(r"\[auth_callback_failed\] \{ provider: '(\w+)', reason: '([\w:-]+)'", line)
    if m:
        return 'callback_failed:' + m.group(1) + ':' + m.group(2)
    return 'other_error'

first_created = min((when(u.get('UserCreateDate')) for _, u, _ in no_profile if when(u.get('UserCreateDate'))), default=now)
span_start = max(first_created - timedelta(hours=1), now - timedelta(days=14))
span = web_errors(span_start, now, max_items=20000)
if span is None:
    print('ADMIN_IDENTITY_AUDIT_WEB_AUTH_ERRORS_SPAN=unavailable')
else:
    print(f'ADMIN_IDENTITY_AUDIT_WEB_AUTH_ERRORS_SPAN={span_start:%m-%d}..{now:%m-%d} total={len(span)}')
    per_day = defaultdict(Counter)
    for at, line in span:
        per_day[at.strftime('%m-%d')][category(line)] += 1
    for d in sorted(per_day):
        print('ADMIN_IDENTITY_AUDIT_WEB_AUTH_ERROR_DAY=' + json.dumps({'day': d, **dict(per_day[d].most_common(7))}))

steps = Counter()
samples = {}
PER_USER_BUDGET = 13000  # characters, so the final marker always fits in SSM's 24,000
printed, omitted = 0, 0
for sub, user, user_attrs in sorted(no_profile, key=lambda item: str(item[1].get('UserCreateDate')))[:60]:
    created, modified = when(user.get('UserCreateDate')), when(user.get('UserLastModifiedDate'))
    age_hours = (now - created).total_seconds() / 3600 if created else 0
    reached = step(user, user_attrs, age_hours)
    steps[reached] += 1
    errors = None
    in_retention = bool(created and now - created < timedelta(days=85))
    if in_retention:
        errors = web_errors(created - timedelta(minutes=2), max(created, modified or created) + timedelta(minutes=60))
    by_category = Counter(category(line) for _, line in (errors or []))
    for _, line in (errors or []):
        samples.setdefault(category(line), line)
    session_gaps = [int((at - created).total_seconds()) for at, line in (errors or []) if 'session routing failed' in line]
    events = auth_events(user['Username']) if user.get('Username') else 'unavailable'
    line = 'ADMIN_IDENTITY_AUDIT_NO_PROFILE=' + json.dumps({
        'sub': sub[:8],
        'kind': kind(user.get('Username'), user_attrs.get('email')),
        'dom': domain_class(user_attrs.get('email')),
        'status': user.get('UserStatus'),
        'verified': user_attrs.get('email_verified') == 'true',
        'created': created.strftime('%m-%d %H:%M') if created else None,
        'modified': modified.strftime('%m-%d %H:%M') if modified else None,
        'step': reached,
        'errors': dict(by_category.most_common(4)) if errors is not None else ('logs-unavailable' if in_retention else 'outside-retention'),
        'session_fail_s_after_create': min(session_gaps, key=abs) if session_gaps else None,
        **({} if events == 'unavailable' else {'auth_events': events[:3]}),
    }, sort_keys=True)
    if printed + len(line) > PER_USER_BUDGET:
        omitted += 1
        continue
    printed += len(line) + 1
    print(line)
if omitted:
    print(f'ADMIN_IDENTITY_AUDIT_NO_PROFILE_OMITTED={omitted}')
print('ADMIN_IDENTITY_AUDIT_NO_PROFILE_STEPS=' + json.dumps(dict(steps), sort_keys=True))
print('ADMIN_IDENTITY_AUDIT_NO_PROFILE_STEP_LEGEND=' + json.dumps({k: v for k, v in STEP_LEGEND.items() if k in steps}))
for cat, line in sorted(samples.items())[:12]:
    print('ADMIN_IDENTITY_AUDIT_NO_PROFILE_WEB_ERROR=' + json.dumps({'category': cat, 'line': line[:160]}))

print('ADMIN_IDENTITY_AUDIT_READ_ONLY_VERIFIED=true')
PY

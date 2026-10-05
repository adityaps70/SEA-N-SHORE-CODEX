#!/usr/bin/env bash
# Round 15 follow-up: delete leftover E2E Cognito test users that have no profile, and the focus
# member's stale identity row whose Cognito user no longer exists. plan lists; run-once deletes
# exactly what plan lists (re-checked). Never touches a non-test Cognito user or another row.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
ACTION_FILE="scripts/aws/identity-cleanup-action.txt"
DATABASE_NAME="sea_n_shore"
CLUSTER_ID="sea-n-shore-staging-aurora"
FOCUS_SLUG="aditya"
STALE_ROW_CREATED_DAY="2026-09-03"
MAX_E2E_DELETIONS=60

[[ "${IDENTITY_CLEANUP_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "IDENTITY_CLEANUP_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$IDENTITY_CLEANUP_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  scripts/aws/identity-cleanup.sh \
  scripts/aws/identity-cleanup-action.txt \
  scripts/aws/identity-cleanup.test.mjs \
  .github/workflows/aws-identity-cleanup.yml

[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(tr -d '[:space:]' < "$ACTION_FILE")"
case "$ACTION" in
  plan|run-once|accounts-once) ;;
  *) echo "Unsupported identity cleanup action." >&2; exit 1 ;;
esac
if [[ "$ACTION" != "plan" ]]; then
  [[ "$(git ls-remote origin refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$IDENTITY_CLEANUP_EXPECTED_SHA" ]]
fi

WORK_DIR="$(mktemp -d /var/tmp/sea-n-shore-identity-cleanup.XXXXXXXX)"
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

python3 - "$ACTION" "$USER_POOL_ID" "$AWS_REGION" "$CLUSTER_ARN" "$SECRET_ARN" "$DATABASE_NAME" "$FOCUS_SLUG" "$STALE_ROW_CREATED_DAY" "$MAX_E2E_DELETIONS" <<'PY'
import json
import re
import subprocess
import sys

action, pool, region, cluster_arn, secret_arn, database, focus_slug, stale_day, max_e2e = sys.argv[1:]
max_e2e = int(max_e2e)
# Only the disposable identities the E2E runs create (scripts/aws/onboarding-e2e-*); example.com addresses.
E2E_EMAIL = re.compile(r'^sea-n-shore-e2e-[0-9]+-(seafarer|shore|recruiter|trainer|student|family|enthusiast|other)@example\.com$')
# Every E2E suite's disposable address: onboarding, realtime, events, hiring, learning review.
ANY_E2E_EMAIL = re.compile(r'^sea-n-shore-(?:(realtime|events|hiring|learning-review)-)?e2e-[0-9]+-[a-z]+@example\.com$')
MAX_E2E_ACCOUNTS = 600

def run(label, args, parse=True):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f'{label}_failed: ' + (result.stderr.strip().splitlines() or ['unknown'])[-1][:200])
    return json.loads(result.stdout or '{}') if parse else result.stdout

def sql(label, statement, params=None, transaction_id=None):
    args = ['aws', 'rds-data', 'execute-statement', '--region', region, '--resource-arn', cluster_arn,
            '--secret-arn', secret_arn, '--database', database, '--sql', statement,
            '--format-records-as', 'JSON', '--output', 'json']
    if params:
        args += ['--parameters', json.dumps([{'name': k, 'value': {'stringValue': v}} for k, v in params.items()])]
    if transaction_id:
        args += ['--transaction-id', transaction_id]
    out = run(label, args)
    return json.loads(out.get('formattedRecords') or '[]'), out.get('numberOfRecordsUpdated')

def list_users():
    users = run('list_users', ['aws', 'cognito-idp', 'list-users', '--region', region, '--user-pool-id', pool, '--output', 'json']).get('Users', [])
    out = {}
    for user in users:
        attrs = {a['Name']: a['Value'] for a in user.get('Attributes') or [] if 'Name' in a}
        if attrs.get('sub'):
            out[attrs['sub']] = (user, attrs)
    return out

def mapped_subjects():
    rows, _ = sql('mapped_subjects', "select provider_subject as subject from public.identity_accounts where provider = 'cognito'")
    return {row['subject'] for row in rows}

def e2e_targets(users, mapped):
    targets = []
    for sub, (user, attrs) in users.items():
        email = str(attrs.get('email') or '').strip().lower()
        if E2E_EMAIL.match(email) and sub not in mapped:
            targets.append({'username': user['Username'], 'sub': sub, 'email': email,
                            'status': user.get('UserStatus'), 'created': str(user.get('UserCreateDate'))[:10]})
    return sorted(targets, key=lambda t: (t['created'], t['email']))

def stale_row(users):
    rows, _ = sql('focus_rows', """
      select ia.id::text as id, ia.provider_subject as subject, ia.provider_username as username,
             ia.created_at::date::text as created_day, ia.profile_id::text as profile_id
        from public.identity_accounts ia
        join public.profiles p on p.id = ia.profile_id
       where ia.provider = 'cognito' and p.slug = :slug
       order by ia.created_at, ia.id""", {'slug': focus_slug})
    stale = [r for r in rows if r['subject'] not in users]
    live = [r for r in rows if r['subject'] in users]
    return rows, stale, live

users = list_users()
mapped = mapped_subjects()
targets = e2e_targets(users, mapped)
non_e2e_unmapped = sum(1 for sub, (u, a) in users.items() if sub not in mapped and not E2E_EMAIL.match(str(a.get('email') or '').strip().lower()))
print(f'IDENTITY_CLEANUP_E2E_UNMAPPED_USERS={len(targets)}')
for t in targets:
    print('IDENTITY_CLEANUP_E2E_TARGET=' + json.dumps({k: t[k] for k in ('email', 'status', 'created')}, sort_keys=True))
print(f'IDENTITY_CLEANUP_NON_E2E_UNMAPPED_KEPT={non_e2e_unmapped}')

rows, stale, live = stale_row(users)
print(f'IDENTITY_CLEANUP_FOCUS_ROWS={len(rows)}')
for r in rows:
    print('IDENTITY_CLEANUP_FOCUS_ROW=' + json.dumps({'created': r['created_day'], 'cognito_user': 'present' if r in live else 'missing',
                                                     'kind': 'google' if str(r['username'] or '').lower().startswith('google_') else 'email'}, sort_keys=True))
# Exactly one stale row, the 09-03 email sign-in, and both other sign-ins alive.
eligible = len(stale) == 1 and stale[0]['created_day'] == stale_day and not str(stale[0]['username'] or '').lower().startswith('google_') and len(live) == 2
print(f'IDENTITY_CLEANUP_STALE_ROW_ELIGIBLE={str(eligible).lower()}')
if len(targets) > max_e2e:
    raise SystemExit(f'Refusing: {len(targets)} E2E users exceeds the cap of {max_e2e}.')

def e2e_accounts(users):
    """Profiles whose every sign-in is an E2E address (never an administrator), plus E2E Cognito users without a profile."""
    rows, _ = sql('e2e_rows', """
      select ia.profile_id::text as profile_id, ia.provider_subject as subject, lower(coalesce(ia.email, '')) as email,
             p.full_name as name, p.account_status::text as status, p.created_at::date::text as created,
             exists (select 1 from public.user_roles r where r.user_id = p.id and r.role::text = 'administrator') as is_admin
        from public.identity_accounts ia
        join public.profiles p on p.id = ia.profile_id
       where ia.provider = 'cognito'""")
    by_profile = {}
    for row in rows:
        by_profile.setdefault(row['profile_id'], []).append(row)
    targets, kept_named = [], []
    for pid, prow in by_profile.items():
        all_e2e = all(ANY_E2E_EMAIL.match(r['email']) for r in prow)
        if all_e2e and not prow[0]['is_admin']:
            targets.append({'profile_id': pid, 'name': prow[0]['name'], 'emails': sorted(r['email'] for r in prow),
                            'subjects': sorted(r['subject'] for r in prow), 'created': prow[0]['created'], 'status': prow[0]['status']})
        elif 'e2e' in str(prow[0]['name'] or '').lower():
            kept_named.append({'name': prow[0]['name'], 'created': prow[0]['created'], 'admin': bool(prow[0]['is_admin'])})
    mapped_all = {r['subject'] for r in rows}
    loose = sorted(({'username': u['Username'], 'sub': sub, 'email': str(a.get('email') or '').strip().lower(), 'created': str(u.get('UserCreateDate'))[:10]}
                    for sub, (u, a) in users.items()
                    if sub not in mapped_all and ANY_E2E_EMAIL.match(str(a.get('email') or '').strip().lower())), key=lambda t: (t['created'], t['email']))
    return sorted(targets, key=lambda t: (t['created'], t['emails'])), kept_named, loose

def suite(email):
    m = ANY_E2E_EMAIL.match(email)
    return (m.group(1) or 'onboarding') if m else 'other'

accounts, kept_named, loose = e2e_accounts(users)
from collections import Counter
print(f'IDENTITY_CLEANUP_E2E_ACCOUNTS={len(accounts)}')
print('IDENTITY_CLEANUP_E2E_ACCOUNTS_BY_SUITE=' + json.dumps(dict(Counter(suite(a['emails'][0]) for a in accounts)), sort_keys=True))
for a in accounts:
    print('IDENTITY_CLEANUP_E2E_ACCOUNT=' + json.dumps({'name': a['name'], 'emails': a['emails'], 'created': a['created'], 'status': a['status']}, sort_keys=True))
print(f'IDENTITY_CLEANUP_E2E_LOOSE_COGNITO_USERS={len(loose)}')
for t in loose:
    print('IDENTITY_CLEANUP_E2E_LOOSE=' + json.dumps({'email': t['email'], 'created': t['created']}, sort_keys=True))
print(f'IDENTITY_CLEANUP_E2E_NAMED_KEPT={len(kept_named)}')
for k in kept_named:
    print('IDENTITY_CLEANUP_E2E_NAMED_KEPT_PROFILE=' + json.dumps(k, sort_keys=True))
if len(accounts) + len(loose) > MAX_E2E_ACCOUNTS:
    raise SystemExit(f'Refusing: {len(accounts) + len(loose)} E2E accounts exceeds the cap of {MAX_E2E_ACCOUNTS}.')

if action == 'accounts-once':
    def cognito_username_for(sub):
        found = run('find_sub', ['aws', 'cognito-idp', 'list-users', '--region', region, '--user-pool-id', pool,
                                 '--filter', f'sub = "{sub}"', '--output', 'json']).get('Users', [])
        return found[0]['Username'] if found else None
    profiles_deleted, users_deleted, failures = 0, 0, []
    for a in accounts:
        # Re-checked inside the statement: still only E2E sign-ins, still not an administrator.
        _, n = sql('delete_e2e_profile', """
          delete from public.profiles p
           where p.id = cast(:id as uuid)
             and not exists (select 1 from public.user_roles r where r.user_id = p.id and r.role::text = 'administrator')
             and not exists (select 1 from public.identity_accounts ia where ia.profile_id = p.id
                              and lower(coalesce(ia.email, '')) !~ '^sea-n-shore-((realtime|events|hiring|learning-review)-)?e2e-[0-9]+-[a-z]+@example[.]com$')""",
          {'id': a['profile_id']})
        if n != 1:
            failures.append(a['name'])
            continue
        profiles_deleted += 1
        for sub in a['subjects']:
            username = cognito_username_for(sub)
            if username:
                run('admin_delete_user', ['aws', 'cognito-idp', 'admin-delete-user', '--region', region, '--user-pool-id', pool, '--username', username], parse=False)
                users_deleted += 1
    for t in loose:
        user = run('get_user', ['aws', 'cognito-idp', 'admin-get-user', '--region', region, '--user-pool-id', pool, '--username', t['username'], '--output', 'json'])
        attrs = {x['Name']: x['Value'] for x in user.get('UserAttributes') or []}
        if attrs.get('sub') != t['sub'] or not ANY_E2E_EMAIL.match(str(attrs.get('email') or '').strip().lower()):
            failures.append(t['email'])
            continue
        run('admin_delete_user', ['aws', 'cognito-idp', 'admin-delete-user', '--region', region, '--user-pool-id', pool, '--username', t['username']], parse=False)
        users_deleted += 1
    print(f'IDENTITY_CLEANUP_E2E_PROFILES_DELETED={profiles_deleted}')
    print(f'IDENTITY_CLEANUP_E2E_COGNITO_USERS_DELETED={users_deleted}')
    print(f'IDENTITY_CLEANUP_E2E_FAILURES={len(failures)}')
    for f in failures:
        print('IDENTITY_CLEANUP_E2E_FAILED=' + json.dumps(f))
    users_after = list_users()
    accounts_after, kept_after, loose_after = e2e_accounts(users_after)
    print(f'IDENTITY_CLEANUP_E2E_ACCOUNTS_AFTER={len(accounts_after)}')
    print(f'IDENTITY_CLEANUP_E2E_LOOSE_AFTER={len(loose_after)}')
    if failures or accounts_after or loose_after:
        raise SystemExit('E2E account cleanup left accounts behind.')
    print('IDENTITY_CLEANUP_E2E_ACCOUNTS_VERIFIED=true')
    raise SystemExit(0)

if action == 'plan':
    print('IDENTITY_CLEANUP_PLAN_ONLY_NO_CHANGES')
    raise SystemExit(0)

if not eligible and stale:
    raise SystemExit('Refusing: the stale identity row is not exactly the expected 09-03 email sign-in.')

deleted = 0
for t in targets:
    # Re-check right before each deletion: still an E2E address, still without a profile.
    user = run('get_user', ['aws', 'cognito-idp', 'admin-get-user', '--region', region, '--user-pool-id', pool, '--username', t['username'], '--output', 'json'])
    attrs = {a['Name']: a['Value'] for a in user.get('UserAttributes') or []}
    if attrs.get('sub') != t['sub'] or not E2E_EMAIL.match(str(attrs.get('email') or '').strip().lower()):
        raise SystemExit('Refusing: an E2E target changed identity before deletion.')
    rows_now, _ = sql('recheck_mapping', "select count(*)::int as n from public.identity_accounts where provider_subject = :sub", {'sub': t['sub']})
    if rows_now and rows_now[0]['n'] != 0:
        raise SystemExit('Refusing: an E2E target gained a profile before deletion.')
    run('admin_delete_user', ['aws', 'cognito-idp', 'admin-delete-user', '--region', region, '--user-pool-id', pool, '--username', t['username']], parse=False)
    deleted += 1
print(f'IDENTITY_CLEANUP_E2E_DELETED={deleted}')

stale_deleted = 0
if eligible:
    row = stale[0]
    # The Cognito user must still be gone (by sub), then delete exactly that row.
    found = run('find_stale_sub', ['aws', 'cognito-idp', 'list-users', '--region', region, '--user-pool-id', pool,
                                   '--filter', f'sub = "{row["subject"]}"', '--output', 'json']).get('Users', [])
    if found:
        raise SystemExit('Refusing: the stale row\'s Cognito user exists again.')
    tx = run('begin', ['aws', 'rds-data', 'begin-transaction', '--region', region, '--resource-arn', cluster_arn,
                       '--secret-arn', secret_arn, '--database', database, '--output', 'json'])['transactionId']
    try:
        _, n = sql('delete_stale_row', """
          delete from public.identity_accounts
           where id = cast(:id as uuid) and provider = 'cognito' and provider_subject = :sub
             and profile_id = cast(:profile as uuid) and created_at::date = cast(:day as date)""",
          {'id': row['id'], 'sub': row['subject'], 'profile': row['profile_id'], 'day': stale_day}, tx)
        if n != 1:
            raise SystemExit(f'Refusing: the stale row delete matched {n} rows.')
        left, _ = sql('count_after', "select count(*)::int as n from public.identity_accounts where profile_id = cast(:profile as uuid) and provider = 'cognito'",
                      {'profile': row['profile_id']}, tx)
        if left[0]['n'] != 2:
            raise SystemExit('Refusing: the focus member would not keep exactly two sign-ins.')
        run('commit', ['aws', 'rds-data', 'commit-transaction', '--region', region, '--resource-arn', cluster_arn,
                       '--secret-arn', secret_arn, '--transaction-id', tx, '--output', 'json'])
        stale_deleted = 1
    except BaseException:
        subprocess.run(['aws', 'rds-data', 'rollback-transaction', '--region', region, '--resource-arn', cluster_arn,
                        '--secret-arn', secret_arn, '--transaction-id', tx], capture_output=True)
        raise
print(f'IDENTITY_CLEANUP_STALE_ROW_DELETED={stale_deleted}')

# Verify.
users_after = list_users()
mapped_after = mapped_subjects()
left_e2e = e2e_targets(users_after, mapped_after)
rows_after, stale_after, live_after = stale_row(users_after)
non_e2e_after = sum(1 for sub, (u, a) in users_after.items() if sub not in mapped_after and not E2E_EMAIL.match(str(a.get('email') or '').strip().lower()))
print(f'IDENTITY_CLEANUP_E2E_UNMAPPED_AFTER={len(left_e2e)}')
print(f'IDENTITY_CLEANUP_NON_E2E_UNMAPPED_AFTER={non_e2e_after}')
print(f'IDENTITY_CLEANUP_FOCUS_ROWS_AFTER={len(rows_after)}')
if left_e2e or non_e2e_after != non_e2e_unmapped or stale_after or len(live_after) != 2:
    raise SystemExit('Identity cleanup verification failed.')
print('IDENTITY_CLEANUP_VERIFIED=true')
PY

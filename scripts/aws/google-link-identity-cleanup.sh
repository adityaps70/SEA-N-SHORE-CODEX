#!/usr/bin/env bash
# Delete the dead identity rows the 21 Oct 2026 cognito-google-native-link-repair (repair-once e472900e) left behind.
# That repair deleted each separate Google Cognito user and linked Google into the same person's native user, but
# kept the Google user's identity_accounts row, whose subject no Cognito user issues any more. The Aurora data
# parity audit fails on such rows (runs 40282720975 and 42454416734). The repair now deletes that row itself.
#
# plan lists counts only. delete-once deletes exactly the rows plan counts, and only when there are exactly
# EXPECTED_TARGETS of them. A row is a target only when ALL of these hold:
#   1. provider 'cognito', and no Cognito user has its subject (re-checked by subject right before the delete);
#   2. its profile has a live identity whose Cognito user is a native (not EXTERNAL_PROVIDER), enabled user that
#      lists a linked Google identity, i.e. a working sign-in that Google was linked into;
#   3. its email is that native user's email;
#   4. its provider_username, when set, is that linked Google identity's federated username (google_<id>).
# Every affected profile must keep a working sign-in. Nothing personal is printed: counts and reason codes only.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
ACTION_FILE="scripts/aws/google-link-identity-cleanup-action.txt"
DATABASE_NAME="sea_n_shore"
CLUSTER_ID="sea-n-shore-staging-aurora"
# The parity audit of 26 Oct and 8 Nov 2026: AURORA_PROFILES_WITH_A_MISSING_SIGN_IN={"active:has_other_sign_in": 5}.
EXPECTED_TARGETS=5

[[ "${GOOGLE_LINK_IDENTITY_CLEANUP_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "GOOGLE_LINK_IDENTITY_CLEANUP_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$GOOGLE_LINK_IDENTITY_CLEANUP_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  scripts/aws/google-link-identity-cleanup.sh \
  scripts/aws/google-link-identity-cleanup-action.txt \
  scripts/aws/google-link-identity-cleanup.test.mjs \
  .github/workflows/aws-google-link-identity-cleanup.yml

[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in
  plan|delete-once) ;;
  *) echo "Unsupported Google link identity cleanup action." >&2; exit 1 ;;
esac
if [[ "$ACTION" != "plan" ]]; then
  [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$GOOGLE_LINK_IDENTITY_CLEANUP_EXPECTED_SHA" ]]
fi

WORK_DIR="$(mktemp -d /var/tmp/sea-n-shore-google-link-identity-cleanup.XXXXXXXX)"
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

python3 - "$ACTION" "$USER_POOL_ID" "$AWS_REGION" "$CLUSTER_ARN" "$SECRET_ARN" "$DATABASE_NAME" "$EXPECTED_TARGETS" <<'PY'
import collections
import json
import re
import subprocess
import sys

action, pool, region, cluster_arn, secret_arn, database, expected = sys.argv[1:]
expected = int(expected)
P = 'GOOGLE_LINK_IDENTITY_CLEANUP'
UUID = re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')

def run(label, args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f'{label}_failed')
    try:
        return json.loads(result.stdout or '{}')
    except json.JSONDecodeError:
        raise SystemExit(f'{label}_invalid_json')

def data_api(*extra):
    return ['aws', 'rds-data', *extra, '--region', region, '--resource-arn', cluster_arn, '--secret-arn', secret_arn]

def sql(label, statement, params=None, transaction_id=None):
    args = data_api('execute-statement') + ['--database', database, '--sql', statement, '--format-records-as', 'JSON', '--output', 'json']
    if params:
        args += ['--parameters', json.dumps([{'name': k, 'value': {'stringValue': v}} for k, v in params.items()])]
    if transaction_id:
        args += ['--transaction-id', transaction_id]
    out = run(label, args)
    try:
        return json.loads(out.get('formattedRecords') or '[]'), out.get('numberOfRecordsUpdated')
    except json.JSONDecodeError:
        raise SystemExit(f'{label}_invalid_json')

def norm(value):
    return str(value or '').strip().lower()

def cognito_users():
    users = run('list_users', ['aws', 'cognito-idp', 'list-users', '--region', region, '--user-pool-id', pool, '--output', 'json']).get('Users', [])
    out = {}
    for user in users:
        attrs = {a.get('Name'): a.get('Value') for a in user.get('Attributes') or [] if a.get('Name')}
        if attrs.get('sub'):
            out[attrs['sub']] = (user, attrs)
    return out

def linked_google_usernames(user, attrs):
    """Federated usernames (google_<id>, lower case) of the Google identities linked into a native, enabled user."""
    if user.get('UserStatus') == 'EXTERNAL_PROVIDER' or user.get('Enabled') is False:
        return set()
    try:
        linked = json.loads(attrs.get('identities') or '[]')
    except json.JSONDecodeError:
        return set()
    if not isinstance(linked, list):
        return set()
    return {f"google_{item['userId']}".lower() for item in linked
            if isinstance(item, dict) and item.get('providerName') == 'Google' and isinstance(item.get('userId'), str) and item.get('userId')}

def identity_rows():
    rows, _ = sql('identity_rows', """
      select ia.id::text as id, ia.profile_id::text as profile_id, ia.provider_subject as subject,
             coalesce(ia.email, '') as email, ia.provider_username as username,
             coalesce(p.account_status::text, 'missing') as account_status
        from public.identity_accounts ia
        left join public.profiles p on p.id = ia.profile_id
       where ia.provider = 'cognito'""")
    return rows

# classify:begin
def classify(users, rows):
    """Targets, and a reason code for every other dead row. users: {sub: (user, attrs)}; rows: identity rows."""
    linked_by_profile = collections.defaultdict(list)  # profile -> [(email, {google usernames})] of live linked users
    for row in rows:
        if row['subject'] in users:
            user, attrs = users[row['subject']]
            google = linked_google_usernames(user, attrs)
            if google:
                linked_by_profile[row['profile_id']].append((norm(attrs.get('email')), google))
    targets, kept = [], collections.Counter()
    for row in rows:
        if row['subject'] in users:
            continue
        linked = linked_by_profile.get(row['profile_id'], [])
        same_email = [google for email, google in linked if email and email == norm(row['email'])]
        if not linked:
            kept['no_linked_google_sign_in'] += 1
        elif not same_email:
            kept['email_differs'] += 1
        elif row.get('username') and norm(row['username']) not in set().union(*same_email):
            kept['username_not_the_linked_google'] += 1
        elif not UUID.match(row['subject']) or not UUID.match(row['id']) or not UUID.match(row['profile_id']):
            kept['unexpected_identifier_format'] += 1
        else:
            targets.append(row)
    return targets, kept
# classify:end

users = cognito_users()
rows = identity_rows()
dead = [row for row in rows if row['subject'] not in users]
targets, kept = classify(users, rows)
print(f'{P}_COGNITO_USERS={len(users)}')
print(f'{P}_AURORA_IDENTITIES={len(rows)}')
print(f'{P}_DEAD_IDENTITIES={len(dead)}')
print(f'{P}_DEAD_BY_PROFILE_STATUS=' + json.dumps(dict(sorted(collections.Counter(r['account_status'] for r in dead).items()))))
print(f'{P}_TARGETS={len(targets)}')
print(f'{P}_TARGETS_BY_PROFILE_STATUS=' + json.dumps(dict(sorted(collections.Counter(r['account_status'] for r in targets).items()))))
print(f'{P}_TARGETS_WITH_GOOGLE_USERNAME={sum(1 for r in targets if r.get("username"))}')
print(f'{P}_TARGET_PROFILES={len({r["profile_id"] for r in targets})}')
print(f'{P}_DEAD_KEPT=' + json.dumps(dict(sorted(kept.items()))))
print(f'{P}_EXPECTED_TARGETS={expected}')
print(f'{P}_MATCHES_EXPECTED={str(len(targets) == expected).lower()}')

if action == 'plan':
    print(f'{P}_PLAN_ONLY_NO_CHANGES')
    raise SystemExit(0)

if action != 'delete-once':
    raise SystemExit('unsupported_action')
if len(targets) != expected:
    raise SystemExit('target_count_is_not_the_expected_count')

# Right before the delete: each target's Cognito user is still gone, asked by its own subject.
for row in targets:
    found = run('find_subject', ['aws', 'cognito-idp', 'list-users', '--region', region, '--user-pool-id', pool,
                                 '--filter', f'sub = "{row["subject"]}"', '--output', 'json']).get('Users', [])
    if found:
        raise SystemExit('target_cognito_user_exists_again')

live_subjects = set(users)
tx = run('begin_transaction', data_api('begin-transaction') + ['--database', database, '--output', 'json']).get('transactionId')
if not tx:
    raise SystemExit('begin_transaction_failed')
try:
    for row in targets:
        _, n = sql('delete_dead_identity', """
          delete from public.identity_accounts
           where id = cast(:id as uuid) and provider = 'cognito' and provider_subject = :subject
             and profile_id = cast(:profile as uuid)""",
          {'id': row['id'], 'subject': row['subject'], 'profile': row['profile_id']}, tx)
        if n != 1:
            raise SystemExit('delete_matched_other_than_one_row')
    for profile in sorted({row['profile_id'] for row in targets}):
        left, _ = sql('profile_sign_ins_after', """
          select provider_subject as subject from public.identity_accounts
           where profile_id = cast(:profile as uuid) and provider = 'cognito'""", {'profile': profile}, tx)
        if not any(r['subject'] in live_subjects for r in left):
            raise SystemExit('profile_would_lose_its_working_sign_in')
    run('commit_transaction', data_api('commit-transaction') + ['--transaction-id', tx, '--output', 'json'])
except BaseException:
    subprocess.run(data_api('rollback-transaction') + ['--transaction-id', tx], capture_output=True)
    raise
print(f'{P}_DELETED={len(targets)}')

# Verify from scratch.
users_after = cognito_users()
rows_after = identity_rows()
dead_after = [row for row in rows_after if row['subject'] not in users_after]
targets_after, _ = classify(users_after, rows_after)
print(f'{P}_DEAD_IDENTITIES_AFTER={len(dead_after)}')
print(f'{P}_TARGETS_AFTER={len(targets_after)}')
if targets_after or len(dead_after) != len(dead) - len(targets) or len(rows_after) != len(rows) - len(targets):
    raise SystemExit('cleanup_verification_failed')
print(f'{P}_VERIFIED=true')
PY

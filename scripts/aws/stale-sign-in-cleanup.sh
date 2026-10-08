#!/usr/bin/env bash
# Deletes ONE stale sign-in record: the public.identity_accounts row whose Cognito user no longer exists, on an
# active profile that keeps at least one other working sign-in (found by the Aurora data parity audit,
# AURORA_PROFILES_WITH_A_MISSING_SIGN_IN={"active:has_other_sign_in": 1}).
#
# plan       lists the candidates (masked ids only) and the counts; changes nothing.
# delete-once deletes exactly the pinned row below, re-checked inside one transaction: still exactly one
#            candidate, the pinned row, its Cognito user still gone, its profile still active and still holding
#            another sign-in whose Cognito user exists. Anything else rolls back.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
ACTION_FILE="scripts/aws/stale-sign-in-cleanup-action.txt"
DATABASE_NAME="sea_n_shore"
CLUSTER_ID="sea-n-shore-staging-aurora"
# Pinned from plan run 37609424071 (first 8 hex characters of the identity row id and of its profile id). Empty means
# delete-once refuses.
PINNED_IDENTITY_PREFIX="99814dd4"
PINNED_PROFILE_PREFIX="0617eede"

[[ "${STALE_SIGN_IN_CLEANUP_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "STALE_SIGN_IN_CLEANUP_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$STALE_SIGN_IN_CLEANUP_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- scripts/aws/stale-sign-in-cleanup.sh "$ACTION_FILE"
[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in plan|delete-once) ;; *) echo "Unsupported stale sign-in cleanup action." >&2; exit 1 ;; esac
if [[ "$ACTION" == "delete-once" ]]; then
  [[ "$PINNED_IDENTITY_PREFIX" =~ ^[0-9a-f]{8}$ && "$PINNED_PROFILE_PREFIX" =~ ^[0-9a-f]{8}$ ]] || {
    echo "delete-once needs the row pinned (PINNED_IDENTITY_PREFIX / PINNED_PROFILE_PREFIX)." >&2
    exit 1
  }
  [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$STALE_SIGN_IN_CLEANUP_EXPECTED_SHA" ]] || {
    echo "Branch moved after the stale sign-in cleanup started; refusing stale execution." >&2
    exit 1
  }
fi

WORK_DIR="$(mktemp -d /var/tmp/sea-n-shore-stale-sign-in.XXXXXXXX)"
trap 'rm -rf -- "$WORK_DIR"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM

aws s3api get-object --bucket "$STATE_BUCKET" --key "$STATE_KEY" --region "$AWS_REGION" "$WORK_DIR/state.json" >/dev/null
USER_POOL_ID="$(jq -r '[.resources[] | select(.mode=="managed" and .type=="aws_cognito_user_pool" and .name=="app") | .instances[0].attributes.id][0] // empty' "$WORK_DIR/state.json")"
rm -f -- "$WORK_DIR/state.json"
[[ "$USER_POOL_ID" == ap-south-1_* ]]

CLUSTER_JSON="$(aws rds describe-db-clusters --region "$AWS_REGION" --db-cluster-identifier "$CLUSTER_ID" --output json)"
CLUSTER_ARN="$(jq -r '.DBClusters[0].DBClusterArn // empty' <<<"$CLUSTER_JSON")"
SECRET_ARN="$(jq -r '.DBClusters[0].MasterUserSecret.SecretArn // empty' <<<"$CLUSTER_JSON")"
[[ "$CLUSTER_ARN" == "arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora" ]]
[[ "$SECRET_ARN" == arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds\!cluster-* ]]

python3 - "$ACTION" "$USER_POOL_ID" "$AWS_REGION" "$CLUSTER_ARN" "$SECRET_ARN" "$DATABASE_NAME" "$PINNED_IDENTITY_PREFIX" "$PINNED_PROFILE_PREFIX" <<'PY'
import json, subprocess, sys

action, pool, region, cluster_arn, secret_arn, database, pinned_identity, pinned_profile = sys.argv[1:]

def run(label, args):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f'{label}_failed: ' + (result.stderr.strip().splitlines() or ['unknown'])[-1][:200])
    return json.loads(result.stdout or '{}')

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

def cognito_subjects():
    users = run('list_users', ['aws', 'cognito-idp', 'list-users', '--region', region, '--user-pool-id', pool, '--output', 'json']).get('Users', [])
    subjects = set()
    for user in users:
        attrs = {a['Name']: a['Value'] for a in user.get('Attributes') or [] if 'Name' in a}
        if not attrs.get('sub'):
            raise SystemExit('Cognito user without a sub')
        subjects.add(attrs['sub'])
    return subjects

IDENTITIES = """
select ia.id::text as id, ia.profile_id::text as profile_id, ia.provider_subject as subject,
       coalesce(p.account_status::text, 'missing') as status
from public.identity_accounts ia left join public.profiles p on p.id = ia.profile_id
where ia.provider = 'cognito'"""

def candidates(rows, subjects):
    """Stale rows: Cognito user gone, profile active, and another row of the same profile still has a Cognito user."""
    live_by_profile = {}
    for row in rows:
        if row['subject'] in subjects:
            live_by_profile[row['profile_id']] = live_by_profile.get(row['profile_id'], 0) + 1
    orphans = [row for row in rows if row['subject'] not in subjects]
    stale = [row for row in orphans if row['status'] == 'active' and live_by_profile.get(row['profile_id'], 0) >= 1]
    return orphans, stale, live_by_profile

def counts(rows, subjects, profile_id=None):
    orphans, stale, live = candidates(rows, subjects)
    out = {'identity_rows': len(rows), 'rows_without_cognito_user': len(orphans), 'stale_candidates': len(stale)}
    if profile_id:
        out['profile_rows'] = sum(1 for r in rows if r['profile_id'] == profile_id)
        out['profile_working_sign_ins'] = live.get(profile_id, 0)
    return out

subjects = cognito_subjects()
rows, _ = sql('identities', IDENTITIES)
orphans, stale, live = candidates(rows, subjects)
for row in stale:
    print('STALE_SIGN_IN_CANDIDATE=' + json.dumps({'identity': row['id'][:8], 'profile': row['profile_id'][:8], 'status': row['status'],
                                                   'profile_working_sign_ins': live.get(row['profile_id'], 0)}, sort_keys=True))
target = stale[0] if len(stale) == 1 else None
print('STALE_SIGN_IN_COUNTS_BEFORE=' + json.dumps(counts(rows, subjects, target and target['profile_id']), sort_keys=True))

if action == 'plan':
    print('STALE_SIGN_IN_CLEANUP_PLAN_ONLY_NO_CHANGES')
    sys.exit(0)

if len(stale) == 0:
    print('STALE_SIGN_IN_CLEANUP_ALREADY_DONE=true')
    sys.exit(0)
if len(stale) != 1:
    raise SystemExit(f'Refusing: {len(stale)} stale candidates, expected exactly 1')
if not (target['id'].startswith(pinned_identity) and target['profile_id'].startswith(pinned_profile)):
    raise SystemExit('Refusing: the stale row is not the pinned row')

tx = run('begin', ['aws', 'rds-data', 'begin-transaction', '--region', region, '--resource-arn', cluster_arn,
                   '--secret-arn', secret_arn, '--database', database, '--output', 'json'])['transactionId']
try:
    # Re-check inside the transaction against a fresh Cognito read, then delete exactly that row.
    subjects = cognito_subjects()
    rows, _ = sql('identities_tx', IDENTITIES + ' for update of ia', transaction_id=tx)
    _, stale_now, live_now = candidates(rows, subjects)
    if [r['id'] for r in stale_now] != [target['id']]:
        raise SystemExit('Refusing: the candidate changed')
    if live_now.get(target['profile_id'], 0) < 1:
        raise SystemExit('Refusing: the profile has no other working sign-in')
    deleted, n = sql('delete', """
      delete from public.identity_accounts
      where id = cast(:id as uuid) and provider = 'cognito' and provider_subject = :subject and profile_id = cast(:profile as uuid)
      returning id::text as id""", {'id': target['id'], 'subject': target['subject'], 'profile': target['profile_id']}, tx)
    if len(deleted) != 1 or deleted[0]['id'] != target['id']:
        raise SystemExit('Refusing: the delete did not remove exactly the pinned row')
    _, n = sql('ledger', """
      insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
      values (null, 'identity_accounts.stale_sign_in_deleted', 'identity_account', :id, cast(:metadata as jsonb))""",
      {'id': target['id'], 'metadata': json.dumps({'profile': target['profile_id'][:8], 'reason': 'cognito_user_missing'})}, tx)
    if n != 1:
        raise SystemExit('Refusing: the ledger row was not written')
    run('commit', ['aws', 'rds-data', 'commit-transaction', '--region', region, '--resource-arn', cluster_arn,
                   '--secret-arn', secret_arn, '--transaction-id', tx, '--output', 'json'])
except BaseException:
    subprocess.run(['aws', 'rds-data', 'rollback-transaction', '--region', region, '--resource-arn', cluster_arn,
                    '--secret-arn', secret_arn, '--transaction-id', tx], capture_output=True)
    raise

rows, _ = sql('identities_after', IDENTITIES)
print('STALE_SIGN_IN_COUNTS_AFTER=' + json.dumps(counts(rows, cognito_subjects(), target['profile_id']), sort_keys=True))
print('STALE_SIGN_IN_CLEANUP_DELETED=' + json.dumps({'identity': target['id'][:8], 'profile': target['profile_id'][:8]}, sort_keys=True))
PY

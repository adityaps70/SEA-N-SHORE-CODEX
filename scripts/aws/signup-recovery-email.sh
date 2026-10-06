#!/usr/bin/env bash
# One-time "please sign in again" email to the 14 people the no-profile audit found (run
# 37491583916): 7 Google sign-ups that never got a profile (scope bug, fixed 10-01) and 7 email
# sign-ups that confirmed but never signed in. plan lists who would get it; send-once sends
# through the Resend sender (mail.seanshore.in), re-checking each person right before, at most
# once per person ever (ledger rows in public.audit_events). Never prints or logs an email
# address: only counts and the first 8 characters of each Cognito id.
set -euo pipefail
umask 077
export AWS_PAGER=""

EXPECTED_ACCOUNT="310356785722"
AWS_REGION="${AWS_REGION:-ap-south-1}"
STATE_BUCKET="sea-n-shore-310356785722-ap-south-1-tfstate"
STATE_KEY="sea-n-shore/staging/terraform.tfstate"
ACTION_FILE="scripts/aws/signup-recovery-email-action.txt"
DATABASE_NAME="sea_n_shore"
CLUSTER_ID="sea-n-shore-staging-aurora"
RESEND_SECRET_ID="sea-n-shore/resend"

[[ "${SIGNUP_RECOVERY_EMAIL_EXPECTED_SHA:-}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "SIGNUP_RECOVERY_EMAIL_EXPECTED_SHA must be an exact commit SHA." >&2
  exit 1
}
[[ "$(git rev-parse HEAD)" == "$SIGNUP_RECOVERY_EMAIL_EXPECTED_SHA" ]]
[[ "$(git remote get-url origin)" == "https://github.com/adityaps70/SEA-N-SHORE-CODEX.git" ]]
git diff --quiet HEAD -- \
  scripts/aws/signup-recovery-email.sh \
  scripts/aws/signup-recovery-email-action.txt \
  scripts/aws/signup-recovery-email.test.mjs \
  .github/workflows/aws-signup-recovery-email.yml

[[ "$(aws sts get-caller-identity --query Account --output text)" == "$EXPECTED_ACCOUNT" ]]

ACTION="$(cut -d' ' -f1 < "$ACTION_FILE" | tr -d '[:space:]')"
case "$ACTION" in
  plan|send-once) ;;
  *) echo "Unsupported signup recovery email action." >&2; exit 1 ;;
esac
if [[ "$ACTION" != "plan" ]]; then
  [[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "$SIGNUP_RECOVERY_EMAIL_EXPECTED_SHA" ]]
fi

WORK_DIR="$(mktemp -d /var/tmp/sea-n-shore-signup-recovery-email.XXXXXXXX)"
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

python3 - "$ACTION" "$USER_POOL_ID" "$AWS_REGION" "$CLUSTER_ARN" "$SECRET_ARN" "$DATABASE_NAME" "$RESEND_SECRET_ID" "$SIGNUP_RECOVERY_EMAIL_EXPECTED_SHA" <<'PY'
import html
import json
import re
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter

action, pool, region, cluster_arn, secret_arn, database, resend_secret_id, run_sha = sys.argv[1:]

# The 14 people from audit run 37491583916, by the first 8 characters of their Cognito sub.
GOOGLE = ['f1a3bdda', '21932d1a', '2143edaa', '21438d4a', '51532d2a', '01b38d3a', 'b1d3fd1a']
EMAIL = ['51232d5a', 'd1731d1a', '11634d1a', '01435d9a', 'f1c32d1a', 'c1f38d9a', '1163dd8a']
MAX_RECIPIENTS = 14
LEDGER_SENDING = 'signup_recovery_email.sending'
LEDGER_SENT = 'signup_recovery_email.sent'
RESEND_ENDPOINT = 'https://api.resend.com/emails'
# The Cognito account-email sender's address (infra/aws/app/cognito-email-sender.tf).
EMAIL_FROM = 'Sea N Shore <accounts@mail.seanshore.in>'
SIGN_IN_URL = 'https://seanshore.in/auth/sign-in'
FOOTER = "You're receiving this because you started signing up at seanshore.in."

MESSAGES = {
    'google': {
        'subject': "Sorry — your Sea N Shore sign-up didn't finish",
        'paragraphs': [
            'Hi,',
            "You tried to join Sea N Shore with Google on 30 Sept or 1 Oct, but a problem on our side stopped your profile from being created. That's fixed now.",
            "Just sign in again with the same Google account and you'll go straight to setting up your profile: https://seanshore.in/auth/sign-in",
            'Sorry for the trouble, and welcome aboard.',
            '— The Sea N Shore team',
        ],
    },
    'email': {
        'subject': 'Finish joining Sea N Shore',
        'paragraphs': [
            'Hi,',
            "You confirmed your email for Sea N Shore but didn't get as far as signing in. We've since fixed an issue that made the sign-up page fail for some people.",
            'Sign in with the email and password you chose to set up your profile: https://seanshore.in/auth/sign-in',
            'Forgot the password? Use "Forgot password" on that page.',
            '— The Sea N Shore team',
        ],
    },
}

E2E_ADDRESS = re.compile(r'^sea-n-shore-(?:[a-z-]+-)?e2e-', re.I)
VALID_ADDRESS = re.compile(r'^[^\s@"<>]+@[^\s@"<>]+\.[^\s@"<>]+$')
RESERVED_DOMAINS = {'example.com', 'example.net', 'example.org'}
RESERVED_TLDS = {'test', 'example', 'invalid', 'localhost'}


def render(group):
    """Plain text plus the same card layout as the Cognito account emails."""
    message = MESSAGES[group]
    text = '\n\n'.join(message['paragraphs'] + [FOOTER]) + '\n'
    link = f'<a href="{SIGN_IN_URL}" style="color:#08789e;font-weight:700">{SIGN_IN_URL}</a>'
    body = '\n'.join(
        f'        <p style="font-size:16px;line-height:1.65">{html.escape(p, quote=False).replace(SIGN_IN_URL, link)}</p>'
        for p in message['paragraphs'])
    page = f'''<!doctype html>
<html>
  <body style="margin:0;background:#f5f8fa;font-family:Arial,sans-serif;color:#123047">
    <div style="max-width:640px;margin:0 auto;padding:32px 18px">
      <div style="background:#fff;border:1px solid #dce8ef;border-radius:18px;padding:32px">
        <p style="margin:0 0 8px;font-size:12px;font-weight:700;letter-spacing:.12em;color:#16789d">SEA N SHORE</p>
{body}
        <p style="margin-top:28px;font-size:12px;line-height:1.6;color:#667987">{html.escape(FOOTER, quote=False)}</p>
      </div>
    </div>
  </body>
</html>'''
    return message['subject'], text, page


def run(label, args, parse=True):
    result = subprocess.run(args, capture_output=True, text=True)
    if result.returncode != 0:
        raise SystemExit(f'{label}_failed: ' + (result.stderr.strip().splitlines() or ['unknown'])[-1][:200])
    return json.loads(result.stdout or '{}') if parse else result.stdout


def sql(label, statement, params=None):
    args = ['aws', 'rds-data', 'execute-statement', '--region', region, '--resource-arn', cluster_arn,
            '--secret-arn', secret_arn, '--database', database, '--sql', statement,
            '--format-records-as', 'JSON', '--output', 'json']
    if params:
        args += ['--parameters', json.dumps([{'name': k, 'value': {'stringValue': v}} for k, v in params.items()])]
    out = run(label, args)
    return json.loads(out.get('formattedRecords') or '[]'), out.get('numberOfRecordsUpdated')


def test_address(address):
    domain = address.rsplit('@', 1)[-1]
    if E2E_ADDRESS.match(address) or domain == 'auth.seaandshore.in':
        return True
    if domain.split('.')[-1] in RESERVED_TLDS:
        return True
    return any(domain == reserved or domain.endswith('.' + reserved) for reserved in RESERVED_DOMAINS)


def subs_by_prefix():
    users = run('list_users', ['aws', 'cognito-idp', 'list-users', '--region', region, '--user-pool-id', pool, '--output', 'json']).get('Users', [])
    found = {prefix: [] for prefix in GOOGLE + EMAIL}
    for user in users:
        sub = next((a.get('Value') for a in user.get('Attributes') or [] if a.get('Name') == 'sub'), '')
        for prefix in found:
            if sub.startswith(prefix):
                found[prefix].append((user['Username'], sub))
    return found


def check(prefix, group, matches):
    """('eligible', sub, address) or ('skipped:<reason>', sub, None), from a fresh read."""
    if not matches:
        return 'skipped:not_found', None, None
    if len(matches) != 1:
        return 'skipped:ambiguous', None, None
    username, sub = matches[0]
    user = run('get_user', ['aws', 'cognito-idp', 'admin-get-user', '--region', region, '--user-pool-id', pool, '--username', username, '--output', 'json'])
    attrs = {a['Name']: a['Value'] for a in user.get('UserAttributes') or []}
    if attrs.get('sub') != sub:
        return 'skipped:changed', sub, None
    if user.get('Enabled') is not True:
        return 'skipped:disabled', sub, None
    address = str(attrs.get('email') or '').strip().lower()
    if not VALID_ADDRESS.match(address):
        return 'skipped:no_email', sub, None
    if test_address(address):
        return 'skipped:test_address', sub, None
    created = str(user.get('UserCreateDate') or '')[:10]
    google_login = username.lower().startswith('google_')
    if group == 'google':
        still = user.get('UserStatus') == 'EXTERNAL_PROVIDER' and google_login and created in ('2026-09-30', '2026-10-01')
    else:
        still = user.get('UserStatus') == 'CONFIRMED' and attrs.get('email_verified') == 'true' and not google_login and '2026-10-01' <= created <= '2026-10-06'
    if not still:
        return 'skipped:state_changed', sub, None
    # A profile through this login, or through any other login with the same address.
    rows, _ = sql('profile_check', """
      select count(*)::int as n from public.identity_accounts
       where (provider = 'cognito' and provider_subject = :sub) or lower(coalesce(email, '')) = :address""",
                  {'sub': sub, 'address': address})
    if rows and rows[0]['n'] > 0:
        return 'skipped:has_profile', sub, None
    rows, _ = sql('ledger_check', """
      select count(*)::int as n from public.audit_events
       where target_type = 'cognito_user' and target_id = :sub and action in (:sending, :sent)""",
                  {'sub': sub, 'sending': LEDGER_SENDING, 'sent': LEDGER_SENT})
    if rows and rows[0]['n'] > 0:
        return 'skipped:already_sent', sub, None
    return 'eligible', sub, address


def report(prefix, group, result):
    print('SIGNUP_RECOVERY_EMAIL_PERSON=' + json.dumps({'id': prefix, 'group': group, 'result': result}, sort_keys=True))


if len(GOOGLE) != 7 or len(EMAIL) != 7 or len(set(GOOGLE + EMAIL)) != MAX_RECIPIENTS:
    raise SystemExit('Refusing: the pinned recipient list is not exactly 14 distinct people.')
for group in MESSAGES:
    render(group)

people = [(p, 'google') for p in GOOGLE] + [(p, 'email') for p in EMAIL]
found = subs_by_prefix()
planned = []
for prefix, group in people:
    result, sub, _ = check(prefix, group, found[prefix])
    planned.append((prefix, group, result))
eligible = [item for item in planned if item[2] == 'eligible']
print(f'SIGNUP_RECOVERY_EMAIL_TARGETS={len(people)}')
print(f'SIGNUP_RECOVERY_EMAIL_ELIGIBLE={len(eligible)}')
if len(eligible) > MAX_RECIPIENTS:
    raise SystemExit(f'Refusing: {len(eligible)} recipients exceeds the cap of {MAX_RECIPIENTS}.')

if action == 'plan':
    for prefix, group, result in planned:
        report(prefix, group, 'would_send' if result == 'eligible' else result)
    print('SIGNUP_RECOVERY_EMAIL_COUNTS=' + json.dumps(dict(Counter('would_send' if r == 'eligible' else r for _, _, r in planned)), sort_keys=True))
    print('SIGNUP_RECOVERY_EMAIL_PLAN_ONLY_NO_CHANGES')
    raise SystemExit(0)

# send-once: the API key stays in memory; it is never printed or passed on a command line.
secret = run('resend_secret', ['aws', 'secretsmanager', 'get-secret-value', '--region', region, '--secret-id', resend_secret_id,
                               '--query', 'SecretString', '--output', 'text'], parse=False).strip()
api_key = secret
if not re.match(r'^re_[A-Za-z0-9_-]{4,}$', api_key):
    try:
        parsed = json.loads(secret)
        api_key = str(parsed.get('RESEND_API_KEY') or parsed.get('api_key') or parsed.get('apiKey') or '').strip()
    except (json.JSONDecodeError, AttributeError):
        api_key = ''
del secret
if not re.match(r'^re_[A-Za-z0-9_-]{4,}$', api_key):
    raise SystemExit('Refusing: the Resend secret does not hold a usable API key.')

outcomes = []
sent_subs = []
for prefix, group, planned_result in planned:
    if planned_result != 'eligible':
        outcomes.append((prefix, group, planned_result))
        continue
    # Re-checked right before sending: still no profile, enabled, not a test address, never sent.
    result, sub, address = check(prefix, group, subs_by_prefix()[prefix])
    if result != 'eligible':
        outcomes.append((prefix, group, result))
        continue
    # The ledger row goes in before the send, so no re-run can ever email this person again.
    _, n = sql('ledger_sending', """
      insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
      values (null, :action, 'cognito_user', :sub, cast(:metadata as jsonb))""",
               {'action': LEDGER_SENDING, 'sub': sub, 'metadata': json.dumps({'group': group, 'run': run_sha[:12]})})
    if n != 1:
        outcomes.append((prefix, group, 'failed:ledger'))
        continue
    subject, text, page = render(group)
    request = urllib.request.Request(RESEND_ENDPOINT, method='POST', data=json.dumps({
        'from': EMAIL_FROM,
        'to': [address],
        'subject': subject,
        'text': text,
        'html': page,
        'tags': [{'name': 'category', 'value': 'account'}, {'name': 'trigger', 'value': 'signup_recovery'}],
    }).encode('utf-8'), headers={
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + api_key,
        'Idempotency-Key': 'signup-recovery-2026-10/' + sub,
        'User-Agent': 'sea-n-shore-signup-recovery/1',
    })
    address = None
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = json.loads(response.read().decode('utf-8') or '{}')
            status = response.status
    except urllib.error.HTTPError as error:
        body, status = {}, error.code
    except (urllib.error.URLError, TimeoutError, ValueError):
        body, status = {}, 0
    resend_id = str(body.get('id') or '') if isinstance(body, dict) else ''
    if 200 <= status < 300 and resend_id:
        sql('ledger_sent', """
          insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
          values (null, :action, 'cognito_user', :sub, cast(:metadata as jsonb))""",
            {'action': LEDGER_SENT, 'sub': sub, 'metadata': json.dumps({'group': group, 'resend_id': resend_id[:64]})})
        outcomes.append((prefix, group, 'sent'))
        sent_subs.append(sub)
    else:
        outcomes.append((prefix, group, f'failed:http_{status}'))
del api_key

for prefix, group, result in outcomes:
    report(prefix, group, result)
counts = Counter(result.split(':')[0] for _, _, result in outcomes)
print('SIGNUP_RECOVERY_EMAIL_COUNTS=' + json.dumps(dict(Counter(r for _, _, r in outcomes)), sort_keys=True))
print(f'SIGNUP_RECOVERY_EMAIL_SENT={counts.get("sent", 0)}')
print(f'SIGNUP_RECOVERY_EMAIL_SKIPPED={counts.get("skipped", 0)}')
print(f'SIGNUP_RECOVERY_EMAIL_FAILED={counts.get("failed", 0)}')
# Verify: one ledger 'sent' row per person emailed in this run.
recorded = 0
for sub in sent_subs:
    rows, _ = sql('ledger_verify', """
      select count(*)::int as n from public.audit_events
       where target_type = 'cognito_user' and target_id = :sub and action = :sent""", {'sub': sub, 'sent': LEDGER_SENT})
    recorded += 1 if rows and rows[0]['n'] == 1 else 0
print(f'SIGNUP_RECOVERY_EMAIL_LEDGER_SENT_ROWS={recorded}')
if counts.get('failed', 0) or recorded != len(sent_subs):
    raise SystemExit('Signup recovery email did not complete cleanly; failed people are recorded and will not be retried.')
print('SIGNUP_RECOVERY_EMAIL_VERIFIED=true')
PY

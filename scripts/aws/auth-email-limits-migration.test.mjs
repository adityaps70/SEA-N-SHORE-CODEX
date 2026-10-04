// Round 14 (2.6): migration 0065 only creates the auth_email_events table and its two indexes,
// behind the usual plan / migrate-once guard.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

test('migration 0065 is additive: one CREATE TABLE IF NOT EXISTS and two CREATE INDEX IF NOT EXISTS', async () => {
  const sql = await read('../../infra/aws/database/migrations/0065_auth_email_limits.sql')
  const statements = sql.split(/^\s*-- statement-breakpoint\s*$/m)
    .map((part) => part.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean)
  assert.equal(statements.length, 3)
  assert.match(statements[0], /^create table if not exists public\.auth_email_events \(/)
  assert.match(statements[0], /id bigserial primary key/)
  assert.match(statements[0], /action text not null check \(action in \('sign_up', 'resend_code', 'password_reset'\)\)/)
  assert.match(statements[0], /email_hash text not null/)
  assert.match(statements[0], /ip_hash text null/)
  assert.match(statements[0], /created_at timestamptz not null default now\(\)/)
  // Only keyed hashes are stored: no clear-text email or IP column.
  assert.doesNotMatch(statements[0], /\b(email|ip|ip_address)\s+(text|inet|citext)/)
  assert.match(statements[1], /^create index if not exists auth_email_events_action_email_created_idx\s+on public\.auth_email_events \(action, email_hash, created_at desc\);$/)
  assert.match(statements[2], /^create index if not exists auth_email_events_action_ip_created_idx\s+on public\.auth_email_events \(action, ip_hash, created_at desc\)\s+where ip_hash is not null;$/)
  const code = sql.replace(/^\s*--.*$/gm, '')
  assert.doesNotMatch(code, /\b(drop|truncate|delete|update|alter|insert|grant|revoke|references)\b/i)
})

test('the runner is guarded, transactional and verifies the table and both indexes', async () => {
  const script = await read('./auth-email-limits-migration.sh')
  const action = (await read('./auth-email-limits-migration-action.txt')).trim()
  const workflow = await read('../../.github/workflows/aws-auth-email-limits-migration.yml')
  const ci = await read('../../.github/workflows/aws-infra-ci.yml')
  assert.ok(['plan', 'migrate-once'].includes(action))
  assert.match(script, /0065_auth_email_limits\.sql/)
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /AUTH_EMAIL_LIMITS_EXPECTED_SHA must be exact/)
  assert.match(script, /git diff --quiet HEAD -- "\$MIGRATION" "\$0" "\$ACTION_FILE"/)
  assert.match(script, /expected 3 statements/)
  assert.match(script, /only CREATE TABLE IF NOT EXISTS and CREATE INDEX IF NOT EXISTS on public\.auth_email_events are allowed/)
  assert.match(script, /destructive SQL forbidden/)
  assert.match(script, /pg_advisory_xact_lock/)
  assert.match(script, /SET LOCAL lock_timeout = '5s'/)
  assert.match(script, /tablename='auth_email_events'/)
  assert.match(script, /auth_email_events_action_email_created_idx/)
  assert.match(script, /auth_email_events_action_ip_created_idx/)
  assert.match(script, /trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)
  // Applying is allowed only from the exact pushed head, and is verified after commit.
  assert.match(script, /git ls-remote origin refs\/heads\/feat\/aws-native-phase-0-1/)
  const commitAt = script.indexOf('commit-transaction')
  const verifyAt = script.indexOf('AUTH_EMAIL_LIMITS_APPLY_VERIFIED=true')
  assert.ok(commitAt > 0 && verifyAt > commitAt, 'the apply must be verified after the commit')
  assert.match(script, /applied \|\| \{ echo "auth_email_events table or indexes missing after apply\." >&2; exit 1; \}/)
  // A SQL migration runs no Terraform, so it does not queue on the bootstrap Terraform lock.
  assert.doesNotMatch(script, /bootstrap-terraform-lock/)
  assert.match(script, /AUTH_EMAIL_LIMITS_PLAN_ONLY_NO_APPLY=true/)
  assert.match(script, /AUTH_EMAIL_LIMITS_APPLY_VERIFIED=true/)
  assert.match(script, /AUTH_EMAIL_LIMITS_ALREADY_APPLIED=true/)
  assert.match(workflow, /name: AWS Auth Email Limits Migration/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /environment: staging/)
  assert.match(workflow, /export AUTH_EMAIL_LIMITS_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /bash scripts\/aws\/auth-email-limits-migration\.sh/)
  assert.match(workflow, /- infra\/aws\/database\/migrations\/0065_auth_email_limits\.sql\n/)
  assert.match(workflow, /trap 'rm -rf "\$D"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)
  assert.match(workflow, /AUTH_EMAIL_LIMITS_\(PLAN_ONLY_NO_APPLY\|APPLY_VERIFIED\|ALREADY_APPLIED\)=true/)
  assert.match(ci, /node --test scripts\/aws\/auth-email-limits-migration\.test\.mjs/)
})

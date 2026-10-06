// Round 14 (3.10): migration 0068 adds the nullable event_outbox.claimed_until lease column, so the
// outbox worker can claim a batch, call EventBridge with no transaction open and then mark the
// results, behind the usual plan / migrate-once guard that runs exactly the reviewed statement.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const migration = read('../../infra/aws/database/migrations/0068_event_outbox_lease.sql')
const script = read('./event-outbox-lease-migration.sh')
const action = guardAction(read('./event-outbox-lease-migration-action.txt'))
const workflow = read('../../.github/workflows/aws-event-outbox-lease-migration.yml')
const ci = read('../../.github/workflows/aws-infra-ci.yml')
const publisher = read('../../src/features/events/outbox-publisher.ts')

const statements = migration.split(/^\s*-- statement-breakpoint\s*$/m)
  .map((part) => part.replace(/^\s*--.*$/gm, '').trim())
  .filter(Boolean)
const code = statements.join('\n')

test('migration 0068 is additive: one nullable lease column, nothing else', () => {
  assert.deepEqual(statements, ['alter table public.event_outbox add column if not exists claimed_until timestamptz;'])
  // Nothing destructive, no data change, no privilege change, no SECURITY DEFINER, no default
  // (a default would rewrite nothing on Postgres 11+, but the column is meant to start NULL).
  assert.doesNotMatch(code, /\b(drop|truncate|grant|revoke|owner|update|insert|delete|default|not null)\b|security\s+definer/i)
  assert.equal(code.match(/\balter\b/gi).length, 1)
})

test('the app claims with the lease column and falls back while it is missing (Postgres 42703)', () => {
  assert.match(publisher, /set claimed_until = now\(\) \+ interval '\$\{OUTBOX_LEASE_SECONDS\} seconds'/)
  assert.match(publisher, /export const OUTBOX_LEASE_SECONDS = 60/)
  assert.match(publisher, /export const OUTBOX_MAX_ATTEMPTS = 10/)
  assert.match(publisher, /candidate\.claimed_until is null or candidate\.claimed_until < now\(\)/)
  assert.match(publisher, /const UNDEFINED_COLUMN = '42703'/)
  assert.match(publisher, /async function publishBatchInTransaction/)
})

test('the runner is guarded, transactional and verifies the column', () => {
  assert.ok(['plan', 'migrate-once'].includes(action))
  assert.match(script, /0068_event_outbox_lease\.sql/)
  assert.match(script, /\[\[ "\$\{EVENT_OUTBOX_LEASE_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$ \]\]/)
  assert.match(script, /\[\[ "\$\(git rev-parse HEAD\)" == "\$EVENT_OUTBOX_LEASE_EXPECTED_SHA" \]\]/)
  assert.match(script, /git diff --quiet HEAD -- "\$MIGRATION" "\$0" "\$ACTION_FILE"/)
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /case "\$ACTION" in plan\|migrate-once\) ;;/)
  assert.match(script, /EVENT_OUTBOX_LEASE_SQL_GUARD=EXACT_REVIEWED_STATEMENTS/)
  assert.match(script, /migration 0068 differs from the reviewed statements/)
  assert.match(script, /SECURITY DEFINER is forbidden/)
  assert.match(script, /pg_advisory_xact_lock\(hashtext\('sea-n-shore-event-outbox-lease-0068'\)/)
  assert.match(script, /SET LOCAL lock_timeout = '5s'/)
  assert.match(script, /table_name='event_outbox' AND column_name='claimed_until' AND data_type='timestamp with time zone' AND is_nullable='YES' AND column_default IS NULL/)
  assert.match(script, /applied\(\)\{ \[\[ "\$\(count "\$COLUMN_SQL"\)" == "1" \]\]; \}/)
  assert.match(script, /public\.event_outbox \(migration 0003\) is missing; refusing to apply/)
  assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1 \| cut -f1\)" == "\$EVENT_OUTBOX_LEASE_EXPECTED_SHA"/)
  assert.match(script, /trap cleanup EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)
  // The apply happens after the plan gate, inside the transaction, and is verified after commit.
  const planGate = script.indexOf('[[ "$ACTION" == "migrate-once" ]]')
  const begin = script.indexOf('aws rds-data begin-transaction')
  const lock = script.indexOf('pg_advisory_xact_lock')
  const timeout = script.indexOf("SET LOCAL lock_timeout = '5s'")
  const commit = script.indexOf('aws rds-data commit-transaction')
  const verified = script.indexOf('EVENT_OUTBOX_LEASE_APPLY_VERIFIED=true')
  assert.ok(planGate > 0 && planGate < begin && begin < lock && lock < timeout && timeout < commit && commit < verified)
  // A SQL migration runs no Terraform, so it does not queue on the bootstrap Terraform lock.
  assert.doesNotMatch(script, /bootstrap-terraform-lock/)
  assert.match(script, /EVENT_OUTBOX_LEASE_PLAN_ONLY_NO_APPLY=true/)
  assert.match(script, /EVENT_OUTBOX_LEASE_APPLY_VERIFIED=true/)
  assert.match(script, /EVENT_OUTBOX_LEASE_ALREADY_APPLIED=true/)
})

test('the workflow triggers only on its own files and runs the runner at the exact head', () => {
  const on = workflow.split('\njobs:')[0]
  const paths = [...on.matchAll(/^ {6}- (\S+)$/gm)].map((match) => match[1])
  assert.deepEqual(paths.sort(), [
    '.github/workflows/aws-event-outbox-lease-migration.yml',
    'infra/aws/database/migrations/0068_event_outbox_lease.sql',
    'scripts/aws/event-outbox-lease-migration-action.txt',
    'scripts/aws/event-outbox-lease-migration.sh',
    'scripts/aws/event-outbox-lease-migration.test.mjs',
  ])
  assert.match(on, /branches: \[feat\/aws-native-phase-0-1\]/)
  assert.match(on, /permissions:\n {2}id-token: write\n {2}contents: read\n {2}actions: read\n/)
  assert.match(on, /concurrency:\n {2}group: sea-n-shore-event-outbox-lease\n {2}cancel-in-progress: false\n/)
  assert.match(workflow, /select\(\.name=="AWS Infrastructure CI"\)/)
  assert.match(workflow, /export EVENT_OUTBOX_LEASE_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /bash scripts\/aws\/event-outbox-lease-migration\.sh/)
  assert.match(workflow, /trap 'rm -rf "\$D"' EXIT; trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)
  assert.match(workflow, /EVENT_OUTBOX_LEASE_\(PLAN_ONLY_NO_APPLY\|APPLY_VERIFIED\|ALREADY_APPLIED\)=true/)
  assert.match(ci, /node --test scripts\/aws\/event-outbox-lease-migration\.test\.mjs/)
})

test("the runner's own SQL guard accepts the reviewed migration and refuses any edit", () => {
  const start = script.indexOf(`python3 - "$MIGRATION" <<'PY'\n`)
  assert.notEqual(start, -1)
  const guard = script.slice(script.indexOf('\n', start) + 1, script.indexOf('\nPY\n', start))
  const dir = mkdtempSync(join(tmpdir(), 'event-outbox-lease-guard-'))
  try {
    const check = (sql) => {
      writeFileSync(join(dir, 'm.sql'), sql)
      return spawnSync('python3', ['-', join(dir, 'm.sql')], { input: guard, encoding: 'utf8' })
    }
    const accepted = check(migration)
    assert.equal(accepted.status, 0, accepted.stderr)
    assert.match(accepted.stdout, /EVENT_OUTBOX_LEASE_SQL_GUARD=EXACT_REVIEWED_STATEMENTS/)
    // Comments and whitespace may change; statements may not.
    assert.equal(check(migration.replace('-- Additive only:', '-- Additive only, reviewed:').replace('add column if not exists', 'add column  if not exists\n   ')).status, 0)
    assert.notEqual(check(`${migration}\n-- statement-breakpoint\ndrop table public.event_outbox;\n`).status, 0)
    assert.notEqual(check(`${migration}\n-- statement-breakpoint\nupdate public.event_outbox set attempts = 0;\n`).status, 0)
    assert.notEqual(check(migration.replace('claimed_until timestamptz;', 'claimed_until timestamptz not null default now();')).status, 0)
    assert.notEqual(check(migration.replace('claimed_until timestamptz;', 'claimed_until timestamp;')).status, 0)
    assert.notEqual(check(migration.replace('public.event_outbox', 'public.profiles')).status, 0)
    assert.notEqual(check(migration.replace(/^alter table.*$/m, '')).status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

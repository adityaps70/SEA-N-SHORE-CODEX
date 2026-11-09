import assert from 'node:assert/strict'
import fs, { readdirSync, readFileSync } from 'node:fs'
import { guardAction } from './guard-value.mjs'

const migrations = [
  '0098_notification_created_event',
]
const script = fs.readFileSync('scripts/aws/notification-created-migration.sh', 'utf8')
const guard = guardAction(fs.readFileSync('scripts/aws/notification-created-migration-action.txt', 'utf8'))
const workflow = fs.readFileSync('.github/workflows/aws-notification-created-migration.yml', 'utf8')

const norm = (text) => text.split(/\s+/).filter(Boolean).join(' ')
const statementsOf = (sql) => sql.split('-- statement-breakpoint')
  .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
  .filter(Boolean)

// The only statements that may relax a rule or rewrite rows, word for word, each approved by the owner. The runner's
// ALLOWED list holds the same statements.
const APPROVED = [
]

assert.ok(['plan', 'migrate-once', 'revert-once'].includes(guard))
const seenApproved = new Set()
for (const name of migrations) {
  const path = `infra/aws/database/migrations/${name}.sql`
  const sql = fs.readFileSync(path, 'utf8')
  assert.ok(script.includes(path), `script applies ${name}`)
  assert.ok(workflow.includes(path), `workflow watches ${name}`)
  assert.match(sql, /-- statement-breakpoint/, `${name} is split into statements`)
  for (const statement of statementsOf(sql)) {
    const flat = norm(statement)
    if (APPROVED.includes(flat)) { seenApproved.add(flat); continue }
    assert.doesNotMatch(statement, /\bdrop\s+(table|column|type|schema|index|function|trigger|constraint)\b/i, `${name} drops nothing: ${flat.slice(0, 80)}`)
    assert.doesNotMatch(statement, /\bdrop\s+not\s+null\b/i, `${name} relaxes nothing: ${flat.slice(0, 80)}`)
    assert.doesNotMatch(statement, /\btruncate\b/i, `${name} truncates nothing`)
    assert.doesNotMatch(statement, /\bdelete\s+from\b/i, `${name} deletes no rows`)
    assert.doesNotMatch(statement, /\bupdate\s+public\./i, `${name} rewrites no rows: ${flat.slice(0, 80)}`)
    assert.doesNotMatch(statement, /\balter\s+column\s+\w+\s+type\b/i, `${name} changes no column type`)
    assert.doesNotMatch(statement, /\bconcurrently\b/i, `${name} is transaction-safe`)
    assert.doesNotMatch(statement, /\bsecurity\s+definer\b/i, `${name} adds no SECURITY DEFINER function`)
  }
}
assert.equal(seenApproved.size, APPROVED.length, 'every approved statement is present exactly as reviewed')
for (const statement of APPROVED) assert.ok(norm(script).includes(statement), `the runner allows: ${statement.slice(0, 60)}`)
// Files must be applied in numeric order.
const order = migrations.map((name) => script.indexOf(name))
assert.deepEqual([...order].sort((a, b) => a - b), order)

assert.match(script, /310356785722/)
assert.match(script, /"\$\{NOTIFICATION_CREATED_MIGRATION_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/)
for (const name of readdirSync(new URL('./', import.meta.url)).filter((n) => n.endsWith('.sh'))) {
  const source = readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')
  for (const m of source.matchAll(/\[([^[\]]*)\]\{40\}/g)) assert.equal(m[1], '0-9a-f', `${name}: ${m[0]}`)
}
assert.match(script, /plan\|migrate-once/)
assert.match(script, /begin-transaction/)
assert.match(script, /commit-transaction/)
assert.match(script, /rollback-transaction/)
assert.match(script, /pg_advisory_xact_lock/)
assert.match(script, /sea_n_shore_applied_migrations/)
assert.match(script, /already_applied 0096_learning_media_renditions/, 'notification created follows 0096_learning_media_renditions')
assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)

// A plan run previews in a transaction it always rolls back, and never commits or writes the ledger.
const plan = script.slice(script.indexOf('if [[ "$ACTION" == "plan" ]]; then'), script.indexOf('echo "NOTIFICATION_CREATED_MIGRATION_PLAN_ONLY_NO_APPLY"'))
assert.ok(plan.length > 0, 'the plan preview is present')
assert.match(plan, /rollback_transaction "\$PREVIEW_TX"/)
assert.doesNotMatch(plan, /commit-transaction|sea_n_shore_applied_migrations/, 'the preview never commits')

// Evidence: each path prints its own last line, and the workflow requires only that line for the run's action.
const lastEcho = (text) => [...text.matchAll(/^\s*echo "(NOTIFICATION_CREATED_MIGRATION_[A-Z_]+(?:=true)?)"$/gm)].at(-1)?.[1]
const nothingPending = script.slice(script.indexOf('if [[ "${#PENDING[@]}" -eq 0 ]]; then'), script.indexOf('if [[ "$ACTION" == "plan" ]]; then'))
assert.equal(lastEcho(nothingPending), 'NOTIFICATION_CREATED_MIGRATION_ALREADY_APPLIED=true')
assert.equal(lastEcho(script.slice(0, script.indexOf('[[ "$(bash scripts/aws/branch-head.sh'))), 'NOTIFICATION_CREATED_MIGRATION_PLAN_ONLY_NO_APPLY')
assert.equal(lastEcho(script), 'NOTIFICATION_CREATED_MIGRATION_APPLY_VERIFIED=true')
const evidence = workflow.slice(workflow.indexOf('# evidence:begin'), workflow.indexOf('# evidence:end'))
  .split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
assert.match(evidence, /grep -q "\$EVIDENCE"/, 'the evidence check is present')
assert.doesNotMatch(evidence, /PLAN_VERIFIED/, 'the evidence check never requires the plan-only PLAN_VERIFIED line')
assert.match(evidence, /\^NOTIFICATION_CREATED_MIGRATION_PLAN_ONLY_NO_APPLY\$/)
assert.match(evidence, /\^NOTIFICATION_CREATED_MIGRATION_APPLY_VERIFIED=true\$/)
assert.match(evidence, /\^NOTIFICATION_CREATED_MIGRATION_ALREADY_APPLIED=true\$/)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /environment: staging-apply/)
assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
assert.match(workflow, /NOTIFICATION_CREATED_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /NOTIFICATION_CREATED_MIGRATION_ACTION/)
assert.match(workflow, /I_APPROVE_NOTIFICATION_CREATED_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/notification-created-migration\.sh/)
assert.match(workflow, /trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)

console.log('NOTIFICATION_CREATED_MIGRATION_CONTRACT_VERIFIED=true')

// Reversible (owner request for Phase 5): an owner-merged "revert-once <sha>" guard hands over to the revert script,
// which drops exactly the trigger and the function and clears the 0098 ledger row, in one transaction, and checks
// each is gone. A manual dispatch can never ask for it.
const revert = fs.readFileSync('scripts/aws/notification-created-revert.sh', 'utf8')
assert.match(script, /plan\|migrate-once\|revert-once\) ;;/)
assert.match(script, /if \[\[ "\$ACTION" == "revert-once" \]\]; then\n  exec bash scripts\/aws\/notification-created-revert\.sh\nfi/)
assert.ok(script.indexOf('exec bash scripts/aws/notification-created-revert.sh') < script.indexOf('CLUSTER_JSON='), 'the hand-over happens before any database work')
assert.ok(workflow.includes('scripts/aws/notification-created-revert.sh'), 'workflow watches the revert script')
const dispatchCase = workflow.slice(workflow.indexOf('if [[ "$GITHUB_EVENT_NAME" == "workflow_dispatch" ]]; then'), workflow.indexOf('          else\n            ACTION="$(cut'))
assert.match(dispatchCase, /case "\$ACTION" in plan\|migrate-once\) ;;/, 'a manual dispatch accepts plan or migrate-once only')
assert.match(workflow, /EVIDENCE='\^NOTIFICATION_CREATED_MIGRATION_REVERT_VERIFIED=true\$'/)
const sqlOf = (text) => [...text.matchAll(/--sql "([^"]+)"/g)].map((m) => m[1])
// read_count passes its argument through as "$1"; every query it is given is a SELECT.
assert.ok([...revert.matchAll(/^[A-Z_]+_SQL="([^"]+)"$/gm)].every((m) => /^SELECT /.test(m[1])), 'the count queries only read')
const writes = sqlOf(revert).filter((sql) => sql !== '$1' && !/^SELECT /.test(sql))
assert.deepEqual(writes, [
  'DROP TRIGGER IF EXISTS notifications_enqueue_created ON public.notifications',
  'DROP FUNCTION IF EXISTS public.enqueue_notification_created()',
  "DELETE FROM public.sea_n_shore_applied_migrations WHERE name='$MIGRATION_NAME'",
], 'the revert changes exactly these three things')
assert.match(revert, /MIGRATION_NAME="0098_notification_created_event"/)
assert.match(revert, /pg_advisory_xact_lock\(hashtext\('sea-n-shore-notification-created-\$MIGRATION_NAME'\)/, 'same lock as the apply')
assert.ok(revert.indexOf('begin_transaction)') < revert.indexOf('DROP TRIGGER') && revert.indexOf('DELETE FROM') < revert.indexOf('commit-transaction'), 'all three in one transaction')
for (const check of [
  /"\$\{NOTIFICATION_CREATED_MIGRATION_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/,
  /git rev-parse HEAD\)" == "\$NOTIFICATION_CREATED_MIGRATION_EXPECTED_SHA"/,
  /git diff --quiet HEAD -- "\$0" "\$RUNNER" "\$ACTION_FILE"/,
  /== "\$EXPECTED_ACCOUNT"/,
  /cut -d' ' -f1 < "\$ACTION_FILE" \| tr -d '\[:space:\]'\)" == "revert-once"/,
  /NOTIFICATION_CREATED_MIGRATION_ACTION:-\}"\)" == "revert-once"/,
  /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/,
  /cluster:sea-n-shore-staging-aurora"/,
]) assert.match(revert, check)
assert.ok(revert.indexOf('branch-head.sh') < revert.indexOf('begin_transaction)'), 'the unmoved-branch check comes before any write')
assert.equal([...revert.matchAll(/^echo "(NOTIFICATION_CREATED_MIGRATION_[A-Z_]+=true)"$/gm)].at(-1)?.[1], 'NOTIFICATION_CREATED_MIGRATION_REVERT_VERIFIED=true')

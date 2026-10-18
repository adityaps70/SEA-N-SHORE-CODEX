import assert from 'node:assert/strict'
import fs, { readdirSync, readFileSync } from 'node:fs'
import { guardAction } from './guard-value.mjs'

const migrations = [
  '0088_site_fixes_round_h_release_2_seo',
]
const script = fs.readFileSync('scripts/aws/site-fixes-round-h-release-2-migration.sh', 'utf8')
const guard = guardAction(fs.readFileSync('scripts/aws/site-fixes-round-h-release-2-migration-action.txt', 'utf8'))
const workflow = fs.readFileSync('.github/workflows/aws-site-fixes-round-h-release-2-migration.yml', 'utf8')

const norm = (text) => text.split(/\s+/).filter(Boolean).join(' ')
const statementsOf = (sql) => sql.split('-- statement-breakpoint')
  .map((part) => part.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n').trim())
  .filter(Boolean)

// The only statements that may relax a rule or rewrite rows, word for word, each approved by the owner. The runner's
// ALLOWED list holds the same statements.
const APPROVED = [
]

assert.ok(['plan', 'migrate-once'].includes(guard))
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
assert.match(script, /"\$\{SITE_FIXES_ROUND_H_RELEASE_2_MIGRATION_EXPECTED_SHA:-\}" =~ \^\[0-9a-f\]\{40\}\$/)
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
assert.match(script, /already_applied 0087_site_fixes_round_h_release_1/, 'site fixes round H release 2 follows 0087_site_fixes_round_h_release_1')
assert.match(script, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)

// A plan run previews in a transaction it always rolls back, and never commits or writes the ledger.
const plan = script.slice(script.indexOf('if [[ "$ACTION" == "plan" ]]; then'), script.indexOf('echo "SITE_FIXES_ROUND_H_RELEASE_2_MIGRATION_PLAN_ONLY_NO_APPLY"'))
assert.ok(plan.length > 0, 'the plan preview is present')
assert.match(plan, /rollback_transaction "\$PREVIEW_TX"/)
assert.doesNotMatch(plan, /commit-transaction|sea_n_shore_applied_migrations/, 'the preview never commits')

// Evidence: each path prints its own last line, and the workflow requires only that line for the run's action.
const lastEcho = (text) => [...text.matchAll(/^\s*echo "(SITE_FIXES_ROUND_H_RELEASE_2_MIGRATION_[A-Z_]+(?:=true)?)"$/gm)].at(-1)?.[1]
const nothingPending = script.slice(script.indexOf('if [[ "${#PENDING[@]}" -eq 0 ]]; then'), script.indexOf('if [[ "$ACTION" == "plan" ]]; then'))
assert.equal(lastEcho(nothingPending), 'SITE_FIXES_ROUND_H_RELEASE_2_MIGRATION_ALREADY_APPLIED=true')
assert.equal(lastEcho(script.slice(0, script.indexOf('[[ "$(bash scripts/aws/branch-head.sh'))), 'SITE_FIXES_ROUND_H_RELEASE_2_MIGRATION_PLAN_ONLY_NO_APPLY')
assert.equal(lastEcho(script), 'SITE_FIXES_ROUND_H_RELEASE_2_MIGRATION_APPLY_VERIFIED=true')
const evidence = workflow.slice(workflow.indexOf('# evidence:begin'), workflow.indexOf('# evidence:end'))
  .split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
assert.match(evidence, /grep -q "\$EVIDENCE"/, 'the evidence check is present')
assert.doesNotMatch(evidence, /PLAN_VERIFIED/, 'the evidence check never requires the plan-only PLAN_VERIFIED line')
assert.match(evidence, /\^SITE_FIXES_ROUND_H_RELEASE_2_MIGRATION_PLAN_ONLY_NO_APPLY\$/)
assert.match(evidence, /\^SITE_FIXES_ROUND_H_RELEASE_2_MIGRATION_APPLY_VERIFIED=true\$/)
assert.match(evidence, /\^SITE_FIXES_ROUND_H_RELEASE_2_MIGRATION_ALREADY_APPLIED=true\$/)

assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
assert.match(workflow, /Guard migration against a moved branch/)
assert.match(workflow, /environment:\s*staging/)
assert.match(workflow, /environment: staging-apply/)
assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
assert.match(workflow, /SITE_FIXES_ROUND_H_RELEASE_2_MIGRATION_EXPECTED_SHA/)
assert.match(workflow, /SITE_FIXES_ROUND_H_RELEASE_2_MIGRATION_ACTION/)
assert.match(workflow, /I_APPROVE_SITE_FIXES_ROUND_H_RELEASE_2_STAGING_MIGRATION/)
assert.match(workflow, /bash scripts\/aws\/site-fixes-round-h-release-2-migration\.sh/)
assert.match(workflow, /trap 'exit 129' HUP; trap 'exit 130' INT; trap 'exit 143' TERM/)

// Round H release 2, H3 email notifications: the 0088 section is additive and idempotent, and the runner checks it.
{
  const sql = fs.readFileSync('infra/aws/database/migrations/0088_site_fixes_round_h_release_2_seo.sql', 'utf8')
  const start = sql.indexOf('-- Round H release 2, H3 email notifications')
  assert.ok(start > 0, '0088 has the H3 email notifications section')
  const end = sql.indexOf('\n-- Round H release 2, ', start + 1)
  const section = end > 0 ? sql.slice(start, end) : sql.slice(start)
  const h3Objects = /member_notification_emails|member_message_digests|email_messages_digest|notifications_email_candidates_idx|messages_created_at_idx/
  const h3Statements = statementsOf(section).filter((statement) => h3Objects.test(statement))
  assert.equal(h3Statements.length, 9, 'the H3 section has its nine statements')
  for (const statement of h3Statements) {
    assert.match(statement, /^(alter table public\.member_preferences\s+add column if not exists|create table if not exists|create index if not exists)/i, `H3 statement is additive and idempotent: ${norm(statement).slice(0, 80)}`)
    if (/^alter table/i.test(statement)) {
      assert.equal(statement.match(/add column if not exists/gi).length, statement.match(/add column/gi).length, 'every H3 column is added with if not exists')
    }
  }
  for (const column of ['email_messages_digest', 'email_connection_requests', 'email_comments', 'email_mentions']) {
    assert.match(section, new RegExp(`add column if not exists ${column} boolean not null default true`), `${column} defaults to on`)
  }
  assert.match(section, /create table if not exists public\.member_message_digests/)
  assert.match(section, /create table if not exists public\.member_notification_emails/)
  assert.match(section, /dedupe_key text not null unique/)
  assert.match(script, /H_RELEASE_2_H3_EMAIL_NOTIFICATIONS_SCHEMA_VERIFIED=true/)
  for (const name of ['email_messages_digest', 'member_message_digests', 'member_notification_emails', 'notifications_email_candidates_idx', 'messages_created_at_idx']) {
    assert.ok(script.includes(name), `the runner checks ${name} after apply`)
  }
}

// Round H release 2, H3 account security: new tables and indexes only, idempotent, and checked by the runner.
{
  const sql = fs.readFileSync('infra/aws/database/migrations/0088_site_fixes_round_h_release_2_seo.sql', 'utf8')
  const start = sql.indexOf('-- Round H release 2, H3 account security')
  assert.ok(start > 0, '0088 has the H3 account security section')
  const end = sql.indexOf('\n-- Round H release 2, ', start + 1)
  const section = end > 0 ? sql.slice(start, end) : sql.slice(start)
  const statements = statementsOf(section)
  assert.equal(statements.length, 9, 'the H3 account security section has its nine statements')
  for (const statement of statements) {
    assert.match(statement, /^(create table if not exists public\.|create index if not exists )/i, `H3 account security statement only creates: ${norm(statement).slice(0, 80)}`)
  }
  for (const table of ['auth_sessions', 'mfa_backup_codes', 'account_security_attempts', 'account_security_emails']) {
    assert.match(section, new RegExp(`create table if not exists public\\.${table} \\(`), `${table} is created`)
    assert.ok(script.includes(`table_name = '${table}'`), `the runner checks ${table} after apply`)
  }
  // Only hashes of tokens, codes and addresses; no raw user agent or IP column.
  assert.match(section, /token_origin_hash text not null unique check \(token_origin_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/)
  assert.match(section, /code_hash text not null check \(code_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/)
  assert.doesNotMatch(section, /\b(ip_address|user_agent|refresh_token|access_token|code_plain)\b\s+text/)
  assert.match(script, /H_RELEASE_2_H3_ACCOUNT_SECURITY_SCHEMA_VERIFIED=true/)
}

console.log('SITE_FIXES_ROUND_H_RELEASE_2_MIGRATION_CONTRACT_VERIFIED=true')

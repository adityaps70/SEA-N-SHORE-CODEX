// Round 14 (2.12): guarded migration 0066 for the least-privilege app database role.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const read = (path) => readFileSync(path, 'utf8')
const migrationRunner = read('scripts/aws/app-database-role-migration.sh')
const migration = read('infra/aws/database/migrations/0066_app_database_role.sql')
const ci = read('.github/workflows/aws-infra-ci.yml')

test('migration 0066 runs exactly the reviewed least-privilege statements', () => {
  assert.match(migration, /create role sea_n_shore_app nologin/)
  assert.doesNotMatch(migration.replace(/^--.*$/gm, ''), /truncate|superuser|createrole|createdb|owner|all privileges/i)
  assert.match(migrationRunner, /APP_DATABASE_ROLE_SQL_GUARD=EXACT_REVIEWED_STATEMENTS/)
  assert.match(migrationRunner, /Some public tables are not owned by the master user; refusing/)
  assert.match(migrationRunner, /APP_DATABASE_ROLE_APPLY_VERIFIED=true/)
  assert.match(ci, /node --test scripts\/aws\/app-database-role-migration\.test\.mjs/)
  assert.ok(['plan', 'migrate-once'].includes(read('scripts/aws/app-database-role-migration-action.txt').trim()))

  // Run the runner's own SQL guard: the reviewed migration passes, any edit is refused.
  const start = migrationRunner.indexOf(`python3 - "$MIGRATION" <<'PY'\n`)
  const guard = migrationRunner.slice(migrationRunner.indexOf('\n', start) + 1, migrationRunner.indexOf('\nPY\n', start))
  const dir = mkdtempSync(join(tmpdir(), 'guard-'))
  try {
    const check = (sql) => {
      writeFileSync(join(dir, 'm.sql'), sql)
      return spawnSync('python3', ['-', join(dir, 'm.sql')], { input: guard, encoding: 'utf8' })
    }
    assert.equal(check(migration).status, 0)
    assert.notEqual(check(migration.replace('select, insert, update, delete on all tables', 'all privileges on all tables')).status, 0)
    assert.notEqual(check(migration + '\n-- statement-breakpoint\ndrop table public.profiles;\n').status, 0)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('the runner reports read-only cutover readiness for the app role', () => {
  const script = readFileSync('scripts/aws/app-database-role-migration.sh', 'utf8')
  assert.match(script, /c\.relrowsecurity/)
  assert.match(script, /has_table_privilege\('sea_n_shore_app', format\('%I\.%I', t\.schemaname, t\.tablename\), 'SELECT,INSERT,UPDATE,DELETE'\)/)
  assert.match(script, /has_sequence_privilege\('sea_n_shore_app', c\.oid, 'USAGE'\)/)
  assert.match(script, /has_function_privilege\('sea_n_shore_app', p\.oid, 'EXECUTE'\)/)
  assert.match(script, /APP_DATABASE_ROLE_CUTOVER_READY=true/)
  assert.match(script, /if applied; then report AFTER; cutover_readiness;/)
})

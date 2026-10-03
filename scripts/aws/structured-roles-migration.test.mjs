import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('structured roles migration adds role keys to profiles and jobs and backfills them without destructive SQL', async () => {
  const sql = await readFile(new URL('../../infra/aws/database/migrations/0062_structured_roles.sql', import.meta.url), 'utf8')
  const statements = sql.split(/^\s*-- statement-breakpoint\s*$/m).map((part) => part.trim()).filter(Boolean)
  assert.equal(statements.length, 10)
  for (const column of ['role_department_key', 'role_key', 'role_other_text', 'cadet_stage_key', 'cadet_course_key', 'target_department_key', 'target_role_key', 'occupation_text']) {
    assert.match(statements[0], new RegExp(`add column if not exists ${column} text`))
  }
  assert.match(statements[3], /add column if not exists department_key text/)
  assert.match(statements[3], /add column if not exists accepted_role_keys text\[\] not null default '\{\}'::text\[\]/)
  assert.match(statements[3], /add column if not exists min_match_to_apply smallint not null default 70/)
  assert.match(statements[5], /min_match_to_apply between 0 and 100/)
  assert.match(statements[8], /where p\.role_key is null/)
  assert.match(statements[9], /where j\.department_key is null/)
  assert.doesNotMatch(sql, /drop\s+(table|column|type|schema|index)|truncate|delete\s+from/i)
  for (const statement of statements) assert.ok(Buffer.byteLength(statement) < 60000, 'fits one Data API statement')

  const scriptUrl = new URL('./structured-roles-migration.sh', import.meta.url)
  const actionUrl = new URL('./structured-roles-migration-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-structured-roles-migration.yml', import.meta.url)
  assert.equal(existsSync(scriptUrl), true)
  assert.equal(existsSync(actionUrl), true)
  assert.equal(existsSync(workflowUrl), true)
  assert.ok(['plan', 'migrate-once'].includes((await readFile(actionUrl, 'utf8')).trim()))

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /0062_structured_roles\.sql/)
  assert.match(script, /plan\|migrate-once/)
  assert.match(script, /expected 10 statements/)
  assert.match(script, /pg_advisory_xact_lock/)
  assert.match(script, /STRUCTURED_ROLES_PLAN_ONLY_NO_APPLY=true/)
  assert.match(script, /STRUCTURED_ROLES_APPLY_VERIFIED=true/)
  assert.match(script, /STRUCTURED_ROLES_ALREADY_APPLIED=true/)
  assert.match(script, /PROFILES_MAPPED/)
  assert.match(script, /JOBS_UNMAPPED/)
  assert.match(script, /Partially applied schema/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /STRUCTURED_ROLES_\(PLAN_ONLY_NO_APPLY\|APPLY_VERIFIED\|ALREADY_APPLIED\)=true/)
  assert.match(workflow, /AWS Infrastructure CI/)

  const ci = await readFile(new URL('../../.github/workflows/aws-infra-ci.yml', import.meta.url), 'utf8')
  assert.match(ci, /node --test scripts\/aws\/structured-roles-migration\.test\.mjs/)
})

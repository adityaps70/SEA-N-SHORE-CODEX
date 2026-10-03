import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('community categories migration adds the category column and seeds the category communities without destructive SQL', async () => {
  const sql = await readFile(new URL('../../infra/aws/database/migrations/0061_community_categories.sql', import.meta.url), 'utf8')
  const statements = sql.split(/^\s*-- statement-breakpoint\s*$/m).map((part) => part.trim()).filter(Boolean)
  assert.equal(statements.length, 7)
  assert.match(sql, /add column if not exists category text/)
  assert.match(sql, /community_groups_category_check/)
  for (const name of ['Maritime News', 'Technical Discussion', 'Vetting & SIRE 2.0', 'Career Advice', 'Safety Lessons', 'Achievement', 'Learning', 'Industry Opinion']) {
    assert.ok(sql.includes(`('${name}'::text`), `seeds ${name}`)
  }
  assert.match(sql, /where not exists/)
  assert.match(sql, /on conflict \(group_id, profile_id\) do nothing/)
  assert.doesNotMatch(sql, /drop\s+(table|column|type|schema)|truncate|delete\s+from/i)

  const scriptUrl = new URL('./community-categories-migration.sh', import.meta.url)
  const actionUrl = new URL('./community-categories-migration-action.txt', import.meta.url)
  const workflowUrl = new URL('../../.github/workflows/aws-community-categories-migration.yml', import.meta.url)
  assert.equal(existsSync(scriptUrl), true)
  assert.equal(existsSync(actionUrl), true)
  assert.equal(existsSync(workflowUrl), true)
  assert.ok(['plan', 'migrate-once'].includes((await readFile(actionUrl, 'utf8')).trim()))

  const script = await readFile(scriptUrl, 'utf8')
  assert.match(script, /0061_community_categories\.sql/)
  assert.match(script, /plan\|migrate-once/)
  assert.match(script, /expected 7 statements/)
  assert.match(script, /pg_advisory_xact_lock/)
  assert.match(script, /COMMUNITY_CATEGORIES_PLAN_ONLY_NO_APPLY=true/)
  assert.match(script, /COMMUNITY_CATEGORIES_APPLY_VERIFIED=true/)
  assert.match(script, /COMMUNITY_CATEGORIES_ALREADY_APPLIED=true/)

  const workflow = await readFile(workflowUrl, 'utf8')
  assert.match(workflow, /COMMUNITY_CATEGORIES_\(PLAN_ONLY_NO_APPLY\|APPLY_VERIFIED\|ALREADY_APPLIED\)=true/)
  assert.match(workflow, /AWS Infrastructure CI/)
})

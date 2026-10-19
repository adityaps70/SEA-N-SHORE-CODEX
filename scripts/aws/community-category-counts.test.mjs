import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Round I (I2): read-only count of communities by category. Counts only, SELECT count(*) only, never a name or id.
test('community category counts only read, and print counts only', async () => {
  const script = await readFile(new URL('./community-category-counts.sh', import.meta.url), 'utf8')
  const workflow = await readFile(new URL('../../.github/workflows/aws-community-category-counts.yml', import.meta.url), 'utf8')

  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /COMMUNITY_CATEGORY_COUNTS_EXPECTED_SHA/)
  // The only database call is execute-statement, and every statement is a count.
  const statements = [...script.matchAll(/read_count "([^"]+)"/g)].map((match) => match[1])
  assert.ok(statements.length >= 10)
  for (const sql of statements) assert.match(sql, /^SELECT count\(\*\)::bigint FROM [^;]+$/, sql)
  assert.doesNotMatch(script.replace(/^#.*$/gm, ''), /\b(insert|update|delete|alter|drop|truncate|create|grant)\b/i)
  assert.doesNotMatch(script, /begin-transaction|batch-execute-statement/)
  // Counts only: no statement selects a name, slug or member data.
  for (const sql of statements) assert.doesNotMatch(sql, /full_name|email|username|\bname\b|profile|SELECT (?!count|c\.id)/i, sql)
  for (const marker of ['COMMUNITIES total=', 'BEFORE', 'MIGRATION_0093_APPLIED=', 'CATEGORIES total=', 'AFTER']) {
    assert.ok(script.includes(`COMMUNITY_CATEGORY_COUNTS_${marker}`), marker)
  }
  assert.match(script, /echo "COMMUNITY_CATEGORY_COUNTS_READ_ONLY_VERIFIED=true"$/m)

  assert.match(workflow, /name: AWS Community Category Counts/)
  assert.match(workflow, /environment: staging\n/)
  assert.doesNotMatch(workflow, /staging-apply|-action\.txt/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /node --test scripts\/aws\/community-category-counts\.test\.mjs/)
  assert.match(workflow, /bash scripts\/aws\/community-category-counts\.sh/)
  assert.match(workflow, /grep -q '\^COMMUNITY_CATEGORY_COUNTS_READ_ONLY_VERIFIED=true\$'/)
})

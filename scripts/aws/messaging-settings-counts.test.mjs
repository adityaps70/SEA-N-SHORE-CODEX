import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

// Read-only count of "Who can message me": counts only, SELECT count(*) only, never a name, email or id.
test('messaging settings counts only read, and print counts only', async () => {
  const script = await readFile(new URL('./messaging-settings-counts.sh', import.meta.url), 'utf8')
  const workflow = await readFile(new URL('../../.github/workflows/aws-messaging-settings-counts.yml', import.meta.url), 'utf8')

  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /MESSAGING_SETTINGS_COUNTS_EXPECTED_SHA/)
  // The only database call is execute-statement, and every statement is a count.
  const statements = [...script.matchAll(/read_count "([^"]+)"/g)].map((match) => match[1])
  assert.ok(statements.length >= 10)
  for (const sql of statements) assert.match(sql, /^SELECT count\(\*\)::bigint FROM \$MEMBERS( AND [^;]+)?$/, sql)
  assert.doesNotMatch(script, /\b(insert|update|delete|alter|drop|truncate|create|grant)\b/i)
  assert.doesNotMatch(script, /begin-transaction|batch-execute-statement/)
  assert.match(script, /p\.account_status = 'active' AND p\.onboarding_completed_at IS NOT NULL/)
  assert.match(script, /coalesce\(mp\.message_permission, 'connections'\)/)
  // Counts only: no statement selects a name, email, username or id.
  const members = script.match(/MEMBERS="([^"]+)"/)[1]
  for (const sql of [...statements, members]) assert.doesNotMatch(sql, /full_name|email|username|slug|SELECT (?!count)/i, sql)
  // The columns read exist in the schema (migrations 0083 and 0087, and the profiles columns).
  const migrations = await Promise.all(['0083_algorithms_round_g.sql', '0087_site_fixes_round_h_release_1.sql']
    .map((file) => readFile(new URL(`../../infra/aws/database/migrations/${file}`, import.meta.url), 'utf8')))
  assert.match(migrations[0], /open_to_recruiters boolean not null default false/)
  assert.match(migrations[1], /add column if not exists message_permission text not null default 'connections'/)
  for (const marker of ['MEMBERS total=', 'SAVED everyone=', 'EFFECTIVE everyone=', 'OPEN_TO_RECRUITERS total=']) {
    assert.ok(script.includes(`MESSAGING_SETTINGS_${marker}`), marker)
  }
  assert.match(script, /echo "MESSAGING_SETTINGS_COUNTS_READ_ONLY_VERIFIED=true"$/m)

  assert.match(workflow, /name: AWS Messaging Settings Counts/)
  assert.match(workflow, /environment: staging\n/)
  assert.doesNotMatch(workflow, /staging-apply|-action\.txt/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /Guard counts against a moved branch/)
  assert.match(workflow, /node --test scripts\/aws\/messaging-settings-counts\.test\.mjs/)
  assert.match(workflow, /bash scripts\/aws\/messaging-settings-counts\.sh/)
  assert.match(workflow, /grep -q '\^MESSAGING_SETTINGS_COUNTS_READ_ONLY_VERIFIED=true\$'/)
})

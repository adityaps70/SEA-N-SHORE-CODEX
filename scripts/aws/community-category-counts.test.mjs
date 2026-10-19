import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

// Runs the script with fake aws and git commands and checks the SQL the database would receive. The first version
// used a variable named GROUPS, which Bash keeps as the user's group ids, so the live run sent "FROM 1001".
function runCounts(categoryIdPresent) {
  const dir = mkdtempSync(join(tmpdir(), 'category-counts-'))
  try {
    const sha = 'a'.repeat(40)
    writeFileSync(join(dir, 'git'), `#!/usr/bin/env bash
case "$1" in
  rev-parse) echo ${sha} ;;
  remote) echo https://github.com/adityaps70/SEA-N-SHORE-CODEX.git ;;
  diff) exit 0 ;;
esac
`)
    writeFileSync(join(dir, 'aws'), `#!/usr/bin/env bash
case "$1 $2" in
  "sts get-caller-identity") echo 310356785722 ;;
  "rds describe-db-clusters") echo '{"DBClusters":[{"DBClusterArn":"arn:aws:rds:ap-south-1:310356785722:cluster:sea-n-shore-staging-aurora","MasterUserSecret":{"SecretArn":"arn:aws:secretsmanager:ap-south-1:310356785722:secret:rds!cluster-placeholder"}}]}' ;;
  "rds-data execute-statement")
    while [[ $# -gt 0 ]]; do if [[ "$1" == --sql ]]; then printf '%s\n' "$2" >> "${dir}/sql"; sql="$2"; fi; shift; done
    if [[ "$sql" == *information_schema* ]]; then echo '{"records":[[{"longValue":${categoryIdPresent ? 1 : 0}}]]}'; else echo '{"records":[[{"longValue":3}]]}'; fi ;;
esac
`)
    chmodSync(join(dir, 'git'), 0o755)
    chmodSync(join(dir, 'aws'), 0o755)
    writeFileSync(join(dir, 'sql'), '')
    const result = spawnSync('bash', [new URL('./community-category-counts.sh', import.meta.url).pathname], {
      encoding: 'utf8',
      env: { PATH: `${dir}:/usr/bin:/bin`, COMMUNITY_CATEGORY_COUNTS_EXPECTED_SHA: sha, HOME: dir },
    })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, sql: readFileSync(join(dir, 'sql'), 'utf8').trim().split('\n').filter(Boolean) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

for (const applied of [false, true]) {
  test(`the counts script sends only well-formed counts on the real tables (0093 ${applied ? 'applied' : 'not applied'})`, () => {
    const result = runCounts(applied)
    assert.equal(result.status, 0, result.stderr)
    assert.ok(result.sql.length >= 20)
    for (const sql of result.sql) {
      assert.match(sql, /^SELECT count\(\*\)::bigint FROM (public\.community_groups g|public\.community_categories c|information_schema\.columns) WHERE /, sql)
    }
    assert.match(result.stdout, /^COMMUNITY_CATEGORY_COUNTS_COMMUNITIES total=3 live=3$/m)
    assert.match(result.stdout, /^COMMUNITY_CATEGORY_COUNTS_BEFORE maritime_news=3\/3 .* none=3\/3 other_text=3 \(all\/live\)$/m)
    assert.match(result.stdout, new RegExp(`^COMMUNITY_CATEGORY_COUNTS_MIGRATION_0093_APPLIED=${applied}$`, 'm'))
    assert.equal(/^COMMUNITY_CATEGORY_COUNTS_AFTER /m.test(result.stdout), applied)
    assert.match(result.stdout, /^COMMUNITY_CATEGORY_COUNTS_READ_ONLY_VERIFIED=true$/m)
  })
}

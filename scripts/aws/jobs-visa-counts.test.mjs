import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Hotfix P5: read-only counts of "N/A"-style visa values, alerts with a visa condition, For You impact and other
// free-text criteria. Counts only, SELECT count(*) only, never a name, email or id.
test('jobs visa counts only read, and print counts only', async () => {
  const script = await readFile(new URL('./jobs-visa-counts.sh', import.meta.url), 'utf8')
  const workflow = await readFile(new URL('../../.github/workflows/aws-jobs-visa-counts.yml', import.meta.url), 'utf8')

  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /JOBS_VISA_COUNTS_EXPECTED_SHA/)
  assert.doesNotMatch(script.replace(/^#.*$/gm, ''), /\b(insert|update|delete|alter|drop|truncate|create|grant)\b/i)
  assert.doesNotMatch(script, /begin-transaction|batch-execute-statement/)
  for (const marker of ['JOBS with_visa=', 'PROFILES with_visa=', 'ALERTS total=', 'FOR_YOU members=', 'OTHER_TEXT']) {
    assert.ok(script.includes(`JOBS_VISA_COUNTS_${marker}`), marker)
  }
  assert.match(script, /echo "JOBS_VISA_COUNTS_READ_ONLY_VERIFIED=true"$/m)

  assert.match(workflow, /name: AWS Jobs Visa Counts/)
  assert.match(workflow, /environment: staging\n/)
  assert.doesNotMatch(workflow, /staging-apply|-action\.txt/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /node --test scripts\/aws\/jobs-visa-counts\.test\.mjs/)
  assert.match(workflow, /bash scripts\/aws\/jobs-visa-counts\.sh/)
  assert.match(workflow, /grep -q '\^JOBS_VISA_COUNTS_READ_ONLY_VERIFIED=true\$'/)
  assert.match(workflow, /contents: read/)
  assert.doesNotMatch(workflow, /contents: write/)
})

// Runs the script with fake aws and git commands and returns the SQL the database would receive.
export function runCounts() {
  const dir = mkdtempSync(join(tmpdir(), 'jobs-visa-counts-'))
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
    while [[ $# -gt 0 ]]; do if [[ "$1" == --sql ]]; then printf '%s\\0' "$2" >> "${dir}/sql"; fi; shift; done
    echo '{"records":[[{"longValue":3}]]}' ;;
esac
`)
    chmodSync(join(dir, 'git'), 0o755)
    chmodSync(join(dir, 'aws'), 0o755)
    writeFileSync(join(dir, 'sql'), '')
    const result = spawnSync('bash', [new URL('./jobs-visa-counts.sh', import.meta.url).pathname], {
      encoding: 'utf8',
      env: { PATH: `${dir}:/usr/bin:/bin`, JOBS_VISA_COUNTS_EXPECTED_SHA: sha, HOME: dir },
    })
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, sql: readFileSync(join(dir, 'sql'), 'utf8').split('\0').filter(Boolean) }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('the counts script sends only counts on the real tables, and prints counts only', () => {
  const result = runCounts()
  assert.equal(result.status, 0, result.stderr)
  assert.ok(result.sql.length >= 20)
  for (const sql of result.sql) {
    assert.match(sql, /^SELECT count\(\*\)::bigint FROM public\.(jobs j|profiles p|job_visa_requirements v|profile_visas pv|job_alerts a)\b[^;]*$/, sql)
    assert.doesNotMatch(sql, /full_name|email|username|slug|\btitle\b/i, sql)
  }
  assert.match(result.stdout, /^JOBS_VISA_COUNTS_JOBS with_visa=3 with_na_style=3 open_with_visa=3 open_with_na_style=3 na_style_values=3$/m)
  assert.match(result.stdout, /^JOBS_VISA_COUNTS_PROFILES with_visa=3 with_na_style=3 na_style_values=3$/m)
  assert.match(result.stdout, /^JOBS_VISA_COUNTS_ALERTS total=3 with_visa_condition=3 enabled_with_visa_condition=3$/m)
  assert.match(result.stdout, /^JOBS_VISA_COUNTS_FOR_YOU members=3 open_jobs_with_required_visa=3 members_missing_a_visa=3 member_job_pairs_hidden_by_visa=3 average_jobs_per_member_up_to=1\.0$/m)
  assert.match(result.stdout, /^JOBS_VISA_COUNTS_OTHER_TEXT certificates=3\/3 vessel_types=3\/3 sailing_regions=3\/3 shore_location=3\/3 \(all\/open jobs\)$/m)
  assert.match(result.stdout, /^JOBS_VISA_COUNTS_READ_ONLY_VERIFIED=true$/m)
  // Nothing but count lines.
  for (const line of result.stdout.trim().split('\n')) assert.match(line, /^JOBS_VISA_COUNTS_[A-Z_]+[ =]/, line)
})

import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { renderRunner, writeRunner } from './templates/guarded-migration/render.mjs'

// The guarded migration runner template (scripts/aws/templates/guarded-migration): a runner made from it passes its
// own contract test, and its evidence check accepts exactly the line each path prints. The old check required the
// plan-only PLAN_VERIFIED line on every run, so successful apply runs went red.

const SAMPLE = {
  name: 'sample-round-migration',
  title: 'sample round',
  after: '0073_learning_round_b',
  migrations: ['infra/aws/database/migrations/0990_sample_types.sql', 'infra/aws/database/migrations/0991_sample_round.sql'],
  previews: ['infra/aws/database/migrations/0991_sample_round.sql'],
}
const M = 'SAMPLE_ROUND_MIGRATION'

function sampleTree(sql = 'create table if not exists public.sample_round (id uuid primary key);') {
  const root = mkdtempSync(path.join(os.tmpdir(), 'guarded-migration-template-'))
  mkdirSync(path.join(root, 'infra/aws/database/migrations'), { recursive: true })
  mkdirSync(path.join(root, 'scripts/aws'), { recursive: true })
  copyFileSync(new URL('./guard-value.mjs', import.meta.url), path.join(root, 'scripts/aws/guard-value.mjs'))
  writeFileSync(path.join(root, SAMPLE.migrations[0]), "-- statement-breakpoint\nalter type public.network_notification_type add value if not exists 'sample';\n")
  writeFileSync(path.join(root, SAMPLE.migrations[1]), `-- statement-breakpoint\n${sql}\n`)
  writeRunner(root, SAMPLE)
  return root
}

// The evidence lines of the "Wait and surface migration evidence" step, as the step's bash runs them.
function evidenceCheck(workflow) {
  const step = workflow.slice(workflow.indexOf('- name: Wait and surface migration evidence'))
  const block = step.slice(step.indexOf('# evidence:begin'), step.indexOf('# evidence:end'))
  assert.ok(block.length > 0, 'the evidence step has its evidence block')
  return block.split('\n').map((line) => line.replace(/^ {10}/, '')).join('\n')
}

function passes(check, action, stdout) {
  const result = spawnSync('bash', ['-c', `set -euo pipefail\n${check}`], { env: { ...process.env, ACTION: action, STDOUT_CONTENT: stdout }, encoding: 'utf8' })
  return result.status === 0
}

const PLAN_OUTPUT = [`${M}_PENDING 0991_sample_round`, `${M}_PREVIEW statements=1 (rolled back)`, `${M}_PLAN_VERIFIED=true`, `${M}_PLAN_ONLY_NO_APPLY`].join('\n')
const APPLY_OUTPUT = [`${M}_PENDING 0991_sample_round`, `${M}_APPLIED 0991_sample_round`, `${M}_APPLY_VERIFIED=true`].join('\n')
const NOTHING_PENDING = [`${M}_ALREADY_APPLIED 0990_sample_types`, `${M}_ALREADY_APPLIED 0991_sample_round`, `${M}_ALREADY_APPLIED=true`].join('\n')

test('a successful apply run passes the evidence check without the plan-only PLAN_VERIFIED line', () => {
  const check = evidenceCheck(renderRunner(SAMPLE)[`.github/workflows/aws-${SAMPLE.name}.yml`])
  const code = check.split('\n').filter((line) => !line.trim().startsWith('#')).join('\n')
  assert.doesNotMatch(code, /PLAN_VERIFIED/)
  assert.ok(passes(check, 'migrate-once', APPLY_OUTPUT), 'apply run with APPLY_VERIFIED')
  assert.ok(passes(check, 'plan', PLAN_OUTPUT), 'plan run with PLAN_ONLY_NO_APPLY')
  assert.ok(passes(check, 'plan', NOTHING_PENDING), 'plan run with nothing pending')
  assert.ok(passes(check, 'migrate-once', NOTHING_PENDING), 'apply run with nothing pending')
})

test('the evidence check still refuses a run that did not finish its own path', () => {
  const check = evidenceCheck(renderRunner(SAMPLE)[`.github/workflows/aws-${SAMPLE.name}.yml`])
  assert.ok(!passes(check, 'migrate-once', `${M}_PENDING 0991_sample_round\n${M}_APPLIED 0991_sample_round`), 'apply without APPLY_VERIFIED')
  assert.ok(!passes(check, 'migrate-once', PLAN_OUTPUT), 'an apply run that only planned')
  assert.ok(!passes(check, 'plan', APPLY_OUTPUT), 'a plan run that printed apply evidence')
  assert.ok(!passes(check, 'plan', `${M}_PENDING 0991_sample_round\n${M}_PLAN_VERIFIED=true`), 'plan without PLAN_ONLY_NO_APPLY')
  // Only whole lines count: the per-file "ALREADY_APPLIED <name>" lines are not the run's evidence.
  assert.ok(!passes(check, 'migrate-once', `${M}_ALREADY_APPLIED 0990_sample_types\n${M}_APPLIED 0991_sample_round`), 'per-file line is not evidence')
  assert.ok(!passes(check, 'migrate-once', ''), 'no output')
})

test('a runner made from the template passes its own contract test, and the runner prints each evidence line on its path', () => {
  const root = sampleTree()
  try {
    const output = execFileSync('node', [`scripts/aws/${SAMPLE.name}.test.mjs`], { cwd: root, encoding: 'utf8' })
    assert.match(output, new RegExp(`${M}_CONTRACT_VERIFIED=true`))
    execFileSync('bash', ['-n', path.join(root, `scripts/aws/${SAMPLE.name}.sh`)])
    assert.equal(readFileSync(path.join(root, `scripts/aws/${SAMPLE.name}-action.txt`), 'utf8'), 'plan\n')
    const workflow = readFileSync(path.join(root, `.github/workflows/aws-${SAMPLE.name}.yml`), 'utf8')
    assert.match(workflow, /^name: AWS Sample Round Migration$/m)
    assert.deepEqual([...workflow.slice(workflow.indexOf('\njobs:\n')).matchAll(/^ {2}([a-z0-9-]+):$/gm)].map((m) => m[1]), ['apply-gate', 'apply-approval', SAMPLE.name])
    assert.match(workflow, /^ {4}environment: staging-apply$/m)
    assert.ok(workflow.includes(`    paths:\n${SAMPLE.migrations.map((file) => `      - ${file}\n`).join('')}`), 'the workflow watches the migrations')
    assert.doesNotMatch(workflow, /@@/)
    // It refuses to overwrite an existing runner.
    assert.throws(() => writeRunner(root, SAMPLE), /already exists/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the contract test of a runner made from the template refuses destructive SQL', () => {
  const root = sampleTree('drop table public.sample_round;')
  try {
    const result = spawnSync('node', [`scripts/aws/${SAMPLE.name}.test.mjs`], { cwd: root, encoding: 'utf8' })
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /drops nothing/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('the renderer refuses bad names, unordered files and unknown placeholders', () => {
  assert.throws(() => renderRunner({ ...SAMPLE, name: 'Sample_Round' }), /--name/)
  assert.throws(() => renderRunner({ ...SAMPLE, migrations: [...SAMPLE.migrations].reverse() }), /numeric order/)
  assert.throws(() => renderRunner({ ...SAMPLE, previews: ['infra/aws/database/migrations/0999_other.sql'] }), /--preview/)
  assert.throws(() => renderRunner({ ...SAMPLE, after: 'round_b' }), /--after/)
})

// Round DB: the concurrent-index step. A file listed with --concurrent-index holds exactly one
// CREATE INDEX CONCURRENTLY IF NOT EXISTS, runs outside a transaction, and is recorded only once the index is valid.
const CONCURRENT_SAMPLE = {
  ...SAMPLE,
  migrations: [...SAMPLE.migrations, 'infra/aws/database/migrations/0992_sample_index.sql'],
  previews: [],
  concurrentIndexes: ['infra/aws/database/migrations/0992_sample_index.sql'],
}
const SAMPLE_INDEX = 'create index concurrently if not exists sample_round_email_idx\n  on public.sample_round (lower(email))\n  where email is not null;'

function concurrentTree(indexSql = SAMPLE_INDEX) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'guarded-migration-concurrent-'))
  mkdirSync(path.join(root, 'infra/aws/database/migrations'), { recursive: true })
  mkdirSync(path.join(root, 'scripts/aws'), { recursive: true })
  copyFileSync(new URL('./guard-value.mjs', import.meta.url), path.join(root, 'scripts/aws/guard-value.mjs'))
  writeFileSync(path.join(root, SAMPLE.migrations[0]), "-- statement-breakpoint\nalter type public.network_notification_type add value if not exists 'sample';\n")
  writeFileSync(path.join(root, SAMPLE.migrations[1]), '-- statement-breakpoint\ncreate table if not exists public.sample_round (id uuid primary key, email text);\n')
  writeFileSync(path.join(root, CONCURRENT_SAMPLE.concurrentIndexes[0]), `-- statement-breakpoint\n${indexSql}\n`)
  writeRunner(root, CONCURRENT_SAMPLE)
  return root
}

test('a runner with a concurrent index passes its contract test, never previews the index and refuses any other shape', () => {
  const root = concurrentTree()
  try {
    assert.match(execFileSync('node', [`scripts/aws/${SAMPLE.name}.test.mjs`], { cwd: root, encoding: 'utf8' }), new RegExp(`${M}_CONTRACT_VERIFIED=true`))
    const script = readFileSync(path.join(root, `scripts/aws/${SAMPLE.name}.sh`), 'utf8')
    execFileSync('bash', ['-n', path.join(root, `scripts/aws/${SAMPLE.name}.sh`)])
    const block = (name) => script.slice(script.indexOf(`${name}=(`), script.indexOf(')', script.indexOf(`${name}=(`)))
    assert.match(block('CONCURRENT_INDEX_MIGRATIONS'), /0992_sample_index\.sql/)
    assert.doesNotMatch(block('PREVIEW_MIGRATIONS'), /0992_sample_index\.sql/, 'the default preview leaves out the concurrent index')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
  for (const bad of [
    'create index sample_round_email_idx on public.sample_round (lower(email));',
    'create unique index concurrently if not exists sample_round_email_idx on public.sample_round (lower(email));',
    `${SAMPLE_INDEX}\n-- statement-breakpoint\ncreate table if not exists public.other (id uuid);`,
    'create index concurrently if not exists sample_round_email_idx on other.sample_round (lower(email));',
  ]) {
    const badRoot = concurrentTree(bad)
    try {
      const result = spawnSync('node', [`scripts/aws/${SAMPLE.name}.test.mjs`], { cwd: badRoot, encoding: 'utf8' })
      assert.notEqual(result.status, 0, bad)
    } finally {
      rmSync(badRoot, { recursive: true, force: true })
    }
  }
  assert.throws(() => renderRunner({ ...CONCURRENT_SAMPLE, concurrentIndexes: ['infra/aws/database/migrations/0999_other.sql'] }), /--concurrent-index/)
  assert.throws(() => renderRunner({ ...CONCURRENT_SAMPLE, previews: CONCURRENT_SAMPLE.concurrentIndexes }), /cannot be previewed/)
  // Without --concurrent-index the rendered runner keeps the plain path for every file.
  assert.match(renderRunner(SAMPLE)[`scripts/aws/${SAMPLE.name}.sh`], /CONCURRENT_INDEX_MIGRATIONS=\(\n\n\)/)
})

// The step's own functions, run against a stubbed Data API: the catalog states it reads, in order, and what it sends.
function runConcurrentStep(states) {
  const root = concurrentTree()
  try {
    const script = readFileSync(path.join(root, `scripts/aws/${SAMPLE.name}.sh`), 'utf8')
    const fn = (name) => {
      const start = script.indexOf(`\n${name}() {`)
      assert.ok(start >= 0, name)
      return script.slice(start, script.indexOf('\n}\n', start) + 3)
    }
    const log = path.join(root, 'calls.log')
    const stateFile = path.join(root, 'states.txt')
    writeFileSync(stateFile, states.join('\n') + '\n')
    const harness = [
      'set -euo pipefail',
      `cd ${JSON.stringify(root)}`,
      `${M}_EXPECTED_SHA=${'a'.repeat(40)}`,
      `data_api() { printf '%s\\n' "$*" >> ${JSON.stringify(log)}; }`,
      'read_count() { echo 0; }',
      `read_text() { local s; s="$(head -1 ${JSON.stringify(stateFile)})"; sed -i 1d ${JSON.stringify(stateFile)}; [[ "$s" == absent ]] || printf '%s\\n' "$s"; }`,
      fn('statements_b64'), fn('concurrent_index_parts'), fn('index_state'), fn('apply_concurrent_index_file'),
      `apply_concurrent_index_file ${CONCURRENT_SAMPLE.concurrentIndexes[0]}`,
    ].join('\n')
    const result = spawnSync('bash', ['-c', harness], { encoding: 'utf8' })
    let calls = ''
    try { calls = readFileSync(log, 'utf8') } catch { calls = '' }
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, calls }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('the concurrent-index step records only a valid index, and drops an INVALID one', () => {
  const ok = runConcurrentStep(['absent', 'valid'])
  assert.equal(ok.status, 0, ok.stderr)
  assert.match(ok.calls, /^--continue-after-timeout --sql create index concurrently if not exists sample_round_email_idx/m)
  assert.doesNotMatch(ok.calls, /DROP INDEX|--transaction-id/)
  assert.match(ok.calls, /INSERT INTO public\.sea_n_shore_applied_migrations \(name, sha256, git_sha\) VALUES \('0992_sample_index'/)
  assert.match(ok.stdout, new RegExp(`^${M}_CONCURRENT_INDEX_VALID index=sample_round_email_idx table=sample_round$`, 'm'))
  assert.match(ok.stdout, new RegExp(`^${M}_APPLIED 0992_sample_index$`, 'm'))

  // An INVALID index left by an earlier interrupted build is dropped before the new build.
  const retried = runConcurrentStep(['invalid', 'valid'])
  assert.equal(retried.status, 0, retried.stderr)
  const lines = retried.calls.trim().split('\n')
  assert.equal(lines[0], '--sql DROP INDEX CONCURRENTLY IF EXISTS public.sample_round_email_idx')
  assert.match(lines[1], /^--continue-after-timeout --sql create index concurrently/)
  assert.match(retried.stdout, /CONCURRENT_INDEX_INVALID_DROPPED index=sample_round_email_idx/)

  // A build that ends INVALID is dropped and fails the run, with no ledger row.
  const broken = runConcurrentStep(['absent', 'invalid'])
  assert.notEqual(broken.status, 0)
  assert.match(broken.calls, /--sql DROP INDEX CONCURRENTLY IF EXISTS public\.sample_round_email_idx\n$/)
  assert.doesNotMatch(broken.calls, /sea_n_shore_applied_migrations/)
  assert.match(broken.stderr, /left an INVALID index; it was dropped/)

  // No index at all after the build fails the run, with no ledger row.
  const missing = runConcurrentStep(['absent', 'absent'])
  assert.notEqual(missing.status, 0)
  assert.doesNotMatch(missing.calls, /sea_n_shore_applied_migrations|DROP INDEX/)
  assert.match(missing.stderr, /was not created/)
})

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

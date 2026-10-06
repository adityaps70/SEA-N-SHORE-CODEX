import assert from 'node:assert/strict'
import { execSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'

// Actions minutes (private repo, 3,000 included minutes/month): fewer and shorter runs, no guard weakened.
const dir = new URL('../../.github/workflows/', import.meta.url)
const workflows = readdirSync(dir).filter((name) => name.endsWith('.yml')).map((name) => ({ name, text: readFileSync(new URL(name, dir), 'utf8') }))
const byName = Object.fromEntries(workflows.map(({ name, text }) => [name, text]))
const jobBlocks = (text) => text.slice(text.indexOf('\njobs:\n')).split(/^(?=  [A-Za-z0-9_-]+:\n)/m).slice(1)

function pushPaths(text) {
  const push = /^  push:\n((?:    .*\n|      .*\n)*)/m.exec(text)?.[1] ?? ''
  const paths = /^    paths:\n((?:      - .*\n)+)/m.exec(push)?.[1] ?? ''
  return paths.split('\n').map((line) => line.replace(/^\s+- /, '').trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
}

test('every job is capped with timeout-minutes', () => {
  for (const { name, text } of workflows) {
    for (const job of jobBlocks(text)) {
      assert.match(job, /^    timeout-minutes: \d+$/m, `${name}: ${job.split('\n')[0].trim()} needs timeout-minutes`)
    }
  }
})

test('a plan (or discover) run is skipped when the push changed none of the runner\'s own scripts', () => {
  const gated = workflows.filter(({ text }) => /^  apply-gate:\n/m.test(text))
  assert.ok(gated.length >= 85, `expected the gated runners, found ${gated.length}`)
  for (const { name, text } of gated) {
    assert.match(text, /^      skip: \$\{\{ steps\.plan_scope\.outputs\.skip \}\}$/m, `${name}: apply-gate outputs skip`)
    assert.match(text, /id: plan_scope\n/, name)
    // Only push events with a read-only guard value can skip; armed runs and dispatches never do.
    assert.ok(text.includes('if [[ "$GITHUB_EVENT_NAME" == "push" && ( "$ACTION" == "plan" || "$ACTION" == "discover" ) ]]; then'), name)
    assert.ok(text.includes('complete = bool(commits) and len(commits) < 2048 and bool(files)'), name)
    // Every job that waits on apply-gate honours the skip.
    const dependants = jobBlocks(text).filter((job) => job.includes("needs.apply-gate.result == 'success'"))
    assert.ok(dependants.length >= 1, name)
    for (const job of dependants) {
      assert.ok(job.includes("needs.apply-gate.result == 'success' && needs.apply-gate.outputs.skip != 'true'"), `${name}: ${job.split('\n')[0].trim()}`)
    }
    // RUNNER_FILES is exactly the trigger paths minus the guard file and this workflow.
    const guard = /GUARD_FILE: (scripts\/aws\/[a-z0-9-]+-action\.txt)/.exec(text)[1]
    const files = /RUNNER_FILES: "([^"]*)"/.exec(text)[1].split(' ').filter(Boolean)
    const expected = name === 'aws-onboarding-e2e.yml' ? [] : pushPaths(text).filter((p) => p !== guard && p !== `.github/workflows/${name}`)
    assert.deepEqual(files, expected, `${name}: RUNNER_FILES`)
    assert.ok(pushPaths(text).includes(guard), `${name}: the guard file still triggers the runner`)
  }
})

test('the onboarding E2E runs only when armed (probe / run-once), never automatically on a merge', () => {
  const text = byName['aws-onboarding-e2e.yml']
  assert.match(text, /RUNNER_FILES: ""/)
})

test('Infra CI: superseded runs cancel; heavy jobs follow the change scope; contract tests always run', () => {
  const text = byName['aws-infra-ci.yml']
  assert.match(text, /concurrency:\n  group: aws-infra-ci-\$\{\{ github\.ref \}\}\n  cancel-in-progress: true/)
  assert.match(text, /fetch-depth: 2\n/)
  assert.match(text, /run: bash scripts\/aws\/infra-ci-scope\.sh/)
  for (const job of ['application', 'terraform', 'guard', 'container']) {
    assert.match(text, new RegExp(`^  ${job}:\\n    name: .*\\n    needs: scope\\n    if: needs\\.scope\\.outputs\\.${job} == 'true'\\n`, 'm'), job)
  }
  const contract = jobBlocks(text).find((job) => job.startsWith('  remote-execution-contract:'))
  assert.doesNotMatch(contract, /needs:|^    if:/m)
  assert.match(contract, /node --test scripts\/aws\/apply-approval-gate\.test\.mjs/)
  assert.match(contract, /node --test scripts\/aws\/actions-minutes\.test\.mjs/)
})

// Behaviour of scripts/aws/infra-ci-scope.sh on real git history, with the GitHub API stubbed.
function scope({ event = 'push', before, merge, parentCi = 'success', api = true, setup }) {
  const root = mkdtempSync(join(tmpdir(), 'ci-scope-'))
  const repo = join(root, 'repo')
  const sh = (cmd) => execSync(cmd, { cwd: repo, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
  mkdirSync(repo)
  sh('git init -q && git config user.email t@t && git config user.name t')
  const write = (file, body) => { mkdirSync(dirname(join(repo, file)), { recursive: true }); writeFileSync(join(repo, file), body) }
  for (const file of ['src/a.ts', 'scripts/aws/x.sh', 'scripts/aws/x-action.txt', 'infra/aws/app/main.tf', 'infra/aws/app/lambda/f.mjs', '.github/workflows/w.yml', 'package.json']) write(file, 'v1\n')
  sh('git add -A && git commit -qm base')
  const base = sh('git rev-parse HEAD')
  sh(`git remote add origin "${repo}"`)
  setup({ write, sh, base })
  const bin = join(root, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'curl'), api
    ? `#!/bin/bash\ncat <<'J'\n{"workflow_runs":[{"name":"AWS Infrastructure CI","conclusion":${JSON.stringify(parentCi)}}]}\nJ\n`
    : '#!/bin/bash\nexit 22\n', { mode: 0o755 })
  const out = join(root, 'out')
  writeFileSync(out, '')
  execSync(`bash "${join(process.cwd(), 'scripts/aws/infra-ci-scope.sh')}"`, {
    cwd: repo, stdio: 'ignore',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_EVENT_NAME: event, GITHUB_SHA: sh('git rev-parse HEAD'), GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'x', BEFORE: before ?? base, GITHUB_OUTPUT: out },
  })
  const result = Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').map((line) => line.split('=')))
  rmSync(root, { recursive: true, force: true })
  return Object.fromEntries(['application', 'terraform', 'guard', 'container'].map((job) => [job, result[job] === 'true']))
}
const ALL = { application: true, terraform: true, guard: true, container: true }
const NONE = { application: false, terraform: false, guard: false, container: false }

test('scope: rearms, workflow-only changes and merges of verified trees skip the heavy jobs', () => {
  assert.deepEqual(scope({ setup: ({ write, sh }) => { write('scripts/aws/x-action.txt', 'apply-once\n'); sh('git commit -qam arm') } }), NONE)
  assert.deepEqual(scope({ setup: ({ write, sh }) => { write('.github/workflows/w.yml', 'v2\n'); sh('git commit -qam wf') } }), NONE)
  assert.deepEqual(scope({
    before: undefined,
    setup: ({ write, sh, base }) => {
      sh('git checkout -qb pr'); write('src/a.ts', 'v2\n'); sh('git commit -qam feature')
      sh(`git checkout -q ${base} && git checkout -qb main && git merge -q --no-ff pr -m merge`)
    },
  }), NONE)
})

test('scope: each heavy job still runs when its own inputs changed', () => {
  assert.deepEqual(scope({ setup: ({ write, sh }) => { write('src/a.ts', 'v2\n'); sh('git commit -qam app') } }), { application: true, terraform: false, guard: false, container: true })
  assert.deepEqual(scope({ setup: ({ write, sh }) => { write('scripts/aws/x.sh', 'v2\n'); sh('git commit -qam script') } }), { application: true, terraform: false, guard: true, container: true })
  assert.deepEqual(scope({ setup: ({ write, sh }) => { write('infra/aws/app/main.tf', 'v2\n'); sh('git commit -qam tf') } }), { application: false, terraform: true, guard: true, container: false })
  // A Lambda's code is linted and tested by Application verify.
  assert.deepEqual(scope({ setup: ({ write, sh }) => { write('infra/aws/app/lambda/f.mjs', 'v2\n'); sh('git commit -qam lambda') } }), ALL)
  assert.deepEqual(scope({ setup: ({ write, sh }) => { write('package.json', 'v2\n'); sh('git commit -qam deps') } }), { application: true, terraform: false, guard: true, container: true })
})

test('scope: any doubt runs everything', () => {
  const arm = ({ write, sh }) => { write('scripts/aws/x-action.txt', 'apply-once\n'); sh('git commit -qam arm') }
  for (const parentCi of ['failure', 'cancelled', null]) assert.deepEqual(scope({ parentCi, setup: arm }), ALL, String(parentCi))
  assert.deepEqual(scope({ api: false, setup: arm }), ALL, 'GitHub API unavailable')
  assert.deepEqual(scope({ event: 'workflow_dispatch', setup: arm }), ALL)
  assert.deepEqual(scope({ event: 'pull_request', setup: arm }), ALL)
  assert.deepEqual(scope({ before: '0000000000000000000000000000000000000000', setup: arm }), ALL)
  // A merge whose tree differs from the PR branch (the branch was behind) is verified in full.
  assert.deepEqual(scope({
    parentCi: 'failure',
    setup: ({ write, sh, base }) => {
      sh('git checkout -qb pr'); write('src/a.ts', 'v2\n'); sh('git commit -qam feature')
      sh(`git checkout -q ${base} && git checkout -qb main`); write('scripts/aws/x.sh', 'v3\n'); sh('git commit -qam other && git merge -q --no-ff pr -m merge')
    },
  }), ALL)
})

test('live checks run once per deploy, not on every push; read-only checks cancel superseded runs', () => {
  for (const name of ['aws-remote-verify.yml', 'aws-google-auth-live-verify.yml', 'aws-logo-browser-verify.yml']) {
    assert.doesNotMatch(byName[name], /^  push:/m, `${name} has no push trigger`)
    assert.match(byName[name], /^  workflow_dispatch:/m, name)
    assert.match(byName[name], /^concurrency:\n  group: .*\n  cancel-in-progress: true$/m, name)
  }
  const deploy = byName['aws-staging-deploy.yml']
  const job = jobBlocks(deploy).find((block) => block.startsWith('  deploy:'))
  assert.match(job, /    permissions:\n      id-token: write\n      contents: read\n      actions: write\n/)
  const verified = job.indexOf('- name: Verify exact ECS deployment')
  const start = job.indexOf('- name: Start the post-deploy checks')
  assert.ok(verified > 0 && start > verified, 'post-deploy checks start only after the rollout is verified')
  assert.match(job.slice(start), /if: env\.DEPLOY_TO_ECS == 'true'/)
  assert.match(job.slice(start), /for workflow in aws-remote-verify\.yml aws-google-auth-live-verify\.yml aws-logo-browser-verify\.yml; do/)
})

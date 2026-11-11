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
  assert.ok(gated.length >= 32, `expected the gated runners, found ${gated.length}`)
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
function scope({ event = 'push', ref, before, parentCi = 'success', parentEvent = 'push', api = true, setup }) {
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
    ? `#!/bin/bash\ncat <<'J'\n{"workflow_runs":[{"name":"AWS Infrastructure CI","event":${JSON.stringify(parentEvent)},"conclusion":${JSON.stringify(parentCi)}}]}\nJ\n`
    : '#!/bin/bash\nexit 22\n', { mode: 0o755 })
  const out = join(root, 'out')
  writeFileSync(out, '')
  execSync(`bash "${join(process.cwd(), 'scripts/aws/infra-ci-scope.sh')}"`, {
    cwd: repo, stdio: 'ignore',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_EVENT_NAME: event, GITHUB_SHA: sh('git rev-parse HEAD'), GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'x', BEFORE: before ?? base, GITHUB_OUTPUT: out, GITHUB_REF: ref ?? FEATURE },
  })
  const result = Object.fromEntries(readFileSync(out, 'utf8').trim().split('\n').map((line) => line.split('=')))
  rmSync(root, { recursive: true, force: true })
  return Object.fromEntries(['application', 'terraform', 'guard', 'container'].map((job) => [job, result[job] === 'true']))
}
const ALL = { application: true, terraform: true, guard: true, container: true }
const FEATURE = 'refs/heads/feat/aws-native-phase-0-1'
const NONE = { application: false, terraform: false, guard: false, container: false }

test('scope: rearms, workflow-only changes and merges of verified trees skip the heavy jobs', () => {
  assert.deepEqual(scope({ setup: ({ write, sh }) => { write('scripts/aws/x-action.txt', 'apply-once\n'); sh('git commit -qam arm') } }), NONE)
  assert.deepEqual(scope({ setup: ({ write, sh }) => { write('.github/workflows/w.yml', 'v2\n'); sh('git commit -qam wf') } }), NONE)
  // A merge reuses its PR branch's checks, but builds the image once if its inputs changed: PR branches no longer
  // build it.
  const merge = (file) => ({ write, sh, base }) => {
    sh('git checkout -qb pr'); write(file, 'v2\n'); sh('git commit -qam feature')
    sh(`git checkout -q ${base} && git checkout -qb main && git merge -q --no-ff pr -m merge`)
  }
  assert.deepEqual(scope({ before: undefined, ref: FEATURE, setup: merge('src/a.ts') }), { ...NONE, container: true })
  assert.deepEqual(scope({ before: undefined, ref: FEATURE, setup: merge('infra/aws/app/main.tf') }), NONE)
  assert.deepEqual(scope({ before: undefined, ref: FEATURE, parentCi: 'failure', setup: merge('infra/aws/app/main.tf') }), ALL)
})

// Round DB (Actions minutes, owner-approved 11 Nov): Infra CI runs on pushes to the feature branch and main and on
// pull requests into them. A PR run is scoped against its base branch tip and never builds the image; a merge reuses its
// PR's passing pull_request run.
test('Infra CI triggers: pushes to the feature branch and main, pull requests into them', () => {
  const text = byName['aws-infra-ci.yml']
  assert.match(text, /^  push:\n    branches:\n      - feat\/aws-native-phase-0-1\n      - main\n    paths:\n/m)
  assert.match(text, /^  pull_request:\n    branches: \[main, feat\/aws-native-phase-0-1\]\n    paths:\n/m)
  assert.match(text, /^  workflow_dispatch:\n/m)
  // The same files trigger both.
  const paths = (block) => [...block.matchAll(/^      - (.+)$/gm)].map((m) => m[1])
  const push = text.slice(text.indexOf('\n  push:\n'), text.indexOf('\n  pull_request:\n'))
  const pr = text.slice(text.indexOf('\n  pull_request:\n'), text.indexOf('\npermissions:'))
  assert.deepEqual(paths(push).filter((p) => !['feat/aws-native-phase-0-1', 'main'].includes(p)), paths(pr))
})

test('scope: a pull request is scoped against its base branch tip and never builds the image', () => {
  const pr = (file) => ({ write, sh }) => { write(file, 'v2\n'); sh(`git commit -qam ${file.replace(/\W/g, '')}`) }
  // An arm PR (a guard file only) skips the heavy jobs once the base tip passed; it never needs the image.
  assert.deepEqual(scope({ event: 'pull_request', ref: 'refs/pull/1/merge', setup: pr('scripts/aws/x-action.txt') }), NONE)
  assert.deepEqual(scope({ event: 'pull_request', ref: 'refs/pull/1/merge', setup: pr('src/a.ts') }), { application: true, terraform: false, guard: false, container: false })
  assert.deepEqual(scope({ event: 'pull_request', ref: 'refs/pull/1/merge', setup: pr('infra/aws/app/main.tf') }), { application: false, terraform: true, guard: true, container: false })
  // Its "before" is the test merge commit's first parent, never the event's own value.
  assert.deepEqual(scope({ event: 'pull_request', ref: 'refs/pull/1/merge', before: '0000000000000000000000000000000000000000', setup: pr('scripts/aws/x-action.txt') }), NONE)
  // A merge to the feature branch reuses its PR's passing pull_request run (and builds the image once).
  const merge = ({ write, sh, base }) => {
    sh('git checkout -qb pr'); write('src/a.ts', 'v2\n'); sh('git commit -qam feature')
    sh(`git checkout -q ${base} && git checkout -qb main && git merge -q --no-ff pr -m merge`)
  }
  assert.deepEqual(scope({ before: undefined, ref: FEATURE, parentEvent: 'pull_request', setup: merge }), { ...NONE, container: true })
  assert.deepEqual(scope({ before: undefined, ref: FEATURE, parentEvent: 'pull_request', parentCi: 'failure', setup: merge }), ALL)
})

test('scope: a push to any branch but the feature branch never builds the image', () => {
  const app = ({ write, sh }) => { write('src/a.ts', 'v2\n'); sh('git commit -qam app') }
  assert.deepEqual(scope({ ref: 'refs/heads/claude/new-session-x', setup: app }), { application: true, terraform: false, guard: false, container: false })
  assert.deepEqual(scope({ ref: 'refs/heads/claude/new-session-x', parentCi: 'failure', setup: app }), { ...ALL, container: false })
  assert.deepEqual(scope({ ref: FEATURE, setup: app }), { application: true, terraform: false, guard: false, container: true })
  // A manual run still builds everything.
  assert.deepEqual(scope({ event: 'workflow_dispatch', ref: 'refs/heads/claude/new-session-x', setup: app }), ALL)
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
  // Round DB: a pull request is scoped against its base branch tip, so with any doubt about that tip it runs
  // everything but the image build (the merge builds the image).
  for (const parentCi of ['failure', 'cancelled', null]) assert.deepEqual(scope({ event: 'pull_request', parentCi, setup: arm }), { ...ALL, container: false }, `pull request, base ${parentCi}`)
  assert.deepEqual(scope({ event: 'pull_request', api: false, setup: arm }), { ...ALL, container: false }, 'pull request, GitHub API unavailable')
  // A run by some other workflow event on that commit is no evidence.
  assert.deepEqual(scope({ parentEvent: 'workflow_dispatch', setup: arm }), ALL)
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

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { guardAction } from './guard-value.mjs'

// Private repository on GitHub Pro: the staging-apply required reviewer is not enforced, so every armed run (any guard
// value but plan/discover) needs its arm commit to be a PR merged by adityaps70 whose guard names the exact SHA it arms.
const ROOT = new URL('../../', import.meta.url).pathname
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const workflows = readdirSync(join(ROOT, '.github/workflows')).filter((n) => n.endsWith('.yml')).map((n) => ({ name: n, text: read(`.github/workflows/${n}`) }))
const byName = Object.fromEntries(workflows.map(({ name, text }) => [name, text]))
const jobOf = (text, id) => text.slice(text.indexOf(`\n  ${id}:\n`) + 1).split(/^(?=  [A-Za-z0-9_-]+:\n)/m)[0]
const PERMS = '    permissions:\n      contents: read\n      pull-requests: read\n'
const step = (guard) => `      - name: Require an owner-merged arm naming the exact SHA\n        env:\n          GH_TOKEN: \${{ github.token }}\n          GUARD_FILE: ${guard}\n        shell: bash\n        run: bash scripts/aws/arm-commit-guard.sh\n`

test('every apply-gate runs the arm guard right after it reads the guard value, before anything can reach AWS', () => {
  const gated = workflows.filter(({ text }) => text.includes('\n  apply-gate:\n'))
  assert.ok(gated.length >= 89, `found ${gated.length}`)
  for (const { name, text } of gated) {
    const gate = jobOf(text, 'apply-gate')
    const guard = /sparse-checkout: \|\n            (scripts\/aws\/[a-z0-9-]+-action\.txt)\n            scripts\/aws\/arm-commit-guard\.sh\n/.exec(gate)?.[1]
    assert.ok(guard, `${name}: apply-gate checks out the guard file and the arm guard`)
    assert.ok(gate.includes(PERMS), `${name}: apply-gate can read pull requests`)
    const decide = gate.indexOf('id: apply_guard')
    const arm = gate.indexOf(step(guard))
    assert.ok(decide > 0 && arm > decide, `${name}: arm guard step (unconditional) after apply_guard`)
    assert.ok(gate.indexOf('id: plan_scope') > arm, `${name}: before the plan-scope step`)
    // Every job that reaches AWS waits for a successful apply-gate.
    for (const job of text.split(/^(?=  [A-Za-z0-9_-]+:\n)/m).filter((b) => /aws-actions\/configure-aws-credentials/.test(b))) {
      assert.match(job, /needs\.apply-gate\.result == 'success'/, `${name}: ${job.split('\n')[0].trim()}`)
    }
  }
})

test('staging deploy (push deploy-once and manual dispatch) and the E2E suites run the arm guard too', () => {
  const gate = jobOf(byName['aws-staging-deploy.yml'], 'gate')
  assert.ok(gate.includes(PERMS))
  const armed = gate.indexOf("      - name: Require an owner-merged arm naming the exact SHA\n        if: steps.resolve.outputs.deploy_to_ecs == 'true'\n        env:\n          GH_TOKEN: ${{ github.token }}\n          GUARD_FILE: scripts/aws/staging-deploy-action.txt\n")
  assert.ok(armed > gate.indexOf('id: resolve') && armed < gate.indexOf('- name: Wait for exact-head AWS Infrastructure CI'))
  assert.match(jobOf(byName['aws-staging-deploy.yml'], 'deploy'), /needs\.gate\.result == 'success'|needs: \[?gate/)
  for (const [name, guard] of [['aws-events-e2e.yml', 'scripts/aws/events-e2e-action.txt'], ['aws-realtime-e2e.yml', 'scripts/aws/realtime-e2e-action.txt']]) {
    const job = jobOf(byName[name], 'guard')
    assert.ok(job.includes(PERMS) && job.includes(step(guard)), name)
    assert.match(job, /uses: actions\/checkout@/)
  }
  // The membership launch sequence never holds AWS credentials; it arms runners whose own guards apply.
  assert.doesNotMatch(byName['aws-membership-launch-sequence.yml'], /configure-aws-credentials/)
})

test('every workflow that reads a guard file and reaches AWS is covered', () => {
  for (const { name, text } of workflows) {
    if (!/scripts\/aws\/[a-z0-9-]+-action\.txt/.test(text) || !/configure-aws-credentials/.test(text)) continue
    assert.ok(text.includes('run: bash scripts/aws/arm-commit-guard.sh'), `${name} has no arm guard`)
  }
})

test('every guard value is plan/discover, or an action with the SHA it arms', () => {
  const guards = readdirSync(join(ROOT, 'scripts/aws')).filter((n) => n.endsWith('-action.txt'))
  assert.ok(guards.length >= 90)
  for (const name of guards) assert.ok(guardAction(read(`scripts/aws/${name}`)), name)
  assert.equal(guardAction('plan\n'), 'plan')
  assert.equal(guardAction(`apply-once ${'a'.repeat(40)}\n`), 'apply-once')
  assert.equal(guardAction(`cleanup-once:123 ${'b'.repeat(40)}`), 'cleanup-once:123')
  for (const bad of ['apply-once\n', `plan ${'a'.repeat(40)}`, `apply-once ${'a'.repeat(39)}`, `apply-once  ${'a'.repeat(40)}`, `apply-once ${'a'.repeat(40)}\nx`]) {
    assert.equal(guardAction(bad), null, JSON.stringify(bad))
  }
})

// ---- Behaviour of scripts/aws/arm-commit-guard.sh with the GitHub API stubbed ----

const HEAD = 'c'.repeat(40)
const ARMED = 'a'.repeat(40)
const GUARD = 'scripts/aws/github-deploy-iam-action.txt'
const good = () => ({
  [`compare/${ARMED}...${HEAD}`]: { status: 'ahead', behind_by: 0, files: [{ filename: GUARD }] },
  [`commits/${HEAD}/pulls`]: [{ number: 7, merge_commit_sha: HEAD, merged_at: '2026-10-06T00:00:00Z', base: { ref: 'feat/aws-native-phase-0-1' } }],
  'pulls/7': { merged: true, merge_commit_sha: HEAD, base: { ref: 'feat/aws-native-phase-0-1' }, merged_by: { login: 'adityaps70' } },
  'pulls/7/files?per_page=100': [{ filename: GUARD }],
})

function guard(content, api = good()) {
  const root = mkdtempSync(join(tmpdir(), 'arm-guard-'))
  try {
    mkdirSync(join(root, 'scripts/aws'), { recursive: true })
    mkdirSync(join(root, 'bin'))
    mkdirSync(join(root, 'api'))
    writeFileSync(join(root, GUARD), content)
    for (const [path, body] of Object.entries(api)) writeFileSync(join(root, 'api', encodeURIComponent(path)), JSON.stringify(body))
    writeFileSync(join(root, 'bin/curl'), `#!/usr/bin/env bash
url="\${@: -1}"; path="\${url#https://api.github.com/repos/o/r/}"
echo "$path" >> "${root}/calls"
f="${root}/api/$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$path")"
[[ -f "$f" ]] || exit 22
cat "$f"
`, { mode: 0o755 })
    writeFileSync(join(root, 'bin/sleep'), '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const run = spawnSync('bash', [join(ROOT, 'scripts/aws/arm-commit-guard.sh')], {
      cwd: root, encoding: 'utf8',
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, GUARD_FILE: GUARD, GITHUB_SHA: HEAD, GITHUB_REPOSITORY: 'o/r', GH_TOKEN: 'x', GITHUB_API_URL: 'https://api.github.com' },
    })
    let calls = []
    try { calls = readFileSync(join(root, 'calls'), 'utf8').trim().split('\n').filter(Boolean) } catch {}
    return { ...run, calls }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('arm guard: read-only values pass without asking GitHub; an owner-merged exact arm passes', () => {
  for (const value of ['plan\n', 'discover\n']) {
    const r = guard(value)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.stdout, /ARM_COMMIT_GUARD read_only/)
    assert.deepEqual(r.calls, [])
  }
  const r = guard(`apply-once ${ARMED}\n`)
  assert.equal(r.status, 0, r.stderr)
  assert.match(r.stdout, new RegExp(`ARM_COMMIT_GUARD armed action=apply-once armed_sha=${ARMED} pr=7 merged_by=adityaps70`))
})

test('arm guard refuses anything else', () => {
  const refuse = (label, content, mutate = () => {}) => {
    const api = good()
    mutate(api)
    const r = guard(content, api)
    assert.notEqual(r.status, 0, `${label} must refuse`)
    assert.doesNotMatch(r.stdout, /ARM_COMMIT_GUARD armed/, label)
  }
  const arm = `apply-once ${ARMED}\n`
  refuse('no SHA in the arm', 'apply-once\n')
  refuse('short SHA', `apply-once ${'a'.repeat(12)}\n`)
  refuse('read-only value with a SHA', `plan ${ARMED}\n`)
  refuse('extra line', `apply-once ${ARMED}\nplan\n`)
  refuse('merged by someone else', arm, (api) => { api['pulls/7'].merged_by.login = 'someone-else' })
  refuse('merged by nobody (closed)', arm, (api) => { api['pulls/7'].merged = false; api['pulls/7'].merged_by = null })
  refuse('merged into another branch', arm, (api) => { api['pulls/7'].base.ref = 'main' })
  refuse('PR changed more than the guard', arm, (api) => { api['pulls/7/files?per_page=100'].push({ filename: 'scripts/aws/github-deploy-iam.sh' }) })
  refuse('run commit is not a PR merge (direct push)', arm, (api) => { api[`commits/${HEAD}/pulls`] = [] })
  refuse('PR merge commit is another commit', arm, (api) => { api[`commits/${HEAD}/pulls`][0].merge_commit_sha = 'd'.repeat(40) })
  refuse('code differs from the armed SHA', arm, (api) => { api[`compare/${ARMED}...${HEAD}`].files.push({ filename: 'infra/aws/bootstrap/main.tf' }) })
  refuse('armed SHA not an ancestor', arm, (api) => { api[`compare/${ARMED}...${HEAD}`].status = 'diverged'; api[`compare/${ARMED}...${HEAD}`].behind_by = 3 })
  refuse('armed SHA is another commit', `apply-once ${'e'.repeat(40)}\n`)
  refuse('GitHub API unavailable', arm, (api) => { for (const k of Object.keys(api)) delete api[k] })
})

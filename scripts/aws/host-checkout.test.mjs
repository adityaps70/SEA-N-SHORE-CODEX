import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

// Private repository: the bootstrap host never talks to GitHub. The runner bundles the exact SHA into the private
// migration bucket (scripts/aws/ci-checkout.sh), the host checks it out from the bundle (scripts/aws/ci_checkout.py)
// and its moved-branch checks read the live branch head the runner publishes (scripts/aws/branch-head.sh).
const ROOT = new URL('../../', import.meta.url).pathname
const read = (path) => readFileSync(join(ROOT, path), 'utf8')
const workflows = readdirSync(join(ROOT, '.github/workflows')).filter((n) => n.endsWith('.yml')).map((n) => ({ name: n, text: read(`.github/workflows/${n}`) }))
const shellScripts = readdirSync(join(ROOT, 'scripts/aws')).filter((n) => n.endsWith('.sh')).map((n) => ({ name: n, text: read(`scripts/aws/${n}`) }))
// Scripts that run on the GitHub runner, never on the host.
const RUNNER_ONLY = new Set(['ci-checkout.sh', 'infra-ci-scope.sh', 'onboarding-e2e-feed-proof-ssm.sh', 'onboarding-e2e-sea-job-ssm.sh'])
const GIT_NETWORK = /\bgit\s+(?:-c\s+\S+\s+)*(?:clone|fetch|pull|ls-remote|remote\s+update|submodule|push)\b/
const jobBlocks = (text) => text.slice(text.indexOf('\njobs:\n')).split(/^(?=  [A-Za-z0-9_-]+:\n)/m).slice(1)

// Every SSM command generator: python heredocs (workflows and the runner-side *-ssm.sh helpers) and jq builders.
function generators(text) {
  const found = []
  for (const m of text.matchAll(/^([ \t]*)python3 - ([^\n]*)<<'([A-Z]+)'\n([\s\S]*?)\n\1\3\n/gm)) found.push({ args: m[2], body: m[4], at: m.index })
  for (const m of text.matchAll(/jq -n [^\n]*commands[^\n]*/g)) found.push({ args: '', body: m[0], at: m.index })
  return found
}
const sources = [...workflows, ...shellScripts.filter((s) => s.name.endsWith('-ssm.sh'))]
const ssmGenerators = sources.flatMap(({ name, text }) => generators(text).filter((g) => /runuser|AWS-RunShellScript|commands/.test(g.body)).map((g) => ({ name, text, ...g })))

test('no SSM command clones, fetches or queries GitHub on the host', () => {
  assert.ok(ssmGenerators.length >= 95, `found ${ssmGenerators.length} SSM generators`)
  for (const { name, body } of ssmGenerators) {
    assert.doesNotMatch(body, GIT_NETWORK, `${name}: git network command in SSM text`)
    assert.doesNotMatch(body, /github\.com|api\.github/, `${name}: GitHub URL in SSM text`)
    assert.doesNotMatch(body, /\bgit clone\b/, name)
  }
  for (const { name, text } of [...workflows, ...shellScripts]) {
    assert.doesNotMatch(text, /git clone[^\n]*github\.com/, `${name} clones from github.com`)
  }
})

test('host scripts never reach GitHub; moved-branch checks read the runner-published head', () => {
  const host = shellScripts.filter(({ name }) => !RUNNER_ONLY.has(name))
  for (const { name, text } of host) {
    const code = text.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n')
    assert.doesNotMatch(code, GIT_NETWORK, `${name}: git network command on the host`)
    assert.doesNotMatch(code, /api\.github\.com|curl[^\n]*github/, `${name}: GitHub API on the host`)
    // The repository URL appears only as the expected value of an origin check.
    for (const line of code.split('\n').filter((l) => l.includes('github.com'))) {
      assert.match(line, /git remote get-url origin|^\s*(?:readonly\s+)?[A-Z_]+="https:\/\/github\.com\/adityaps70\/SEA-N-SHORE-CODEX\.git"$/, `${name}: ${line.trim()}`)
    }
  }
  const checks = host.filter(({ text }) => text.includes('branch-head.sh'))
  assert.ok(checks.length >= 79, `found ${checks.length} host moved-branch checks`)
  for (const { name, text } of checks) {
    assert.match(text, /bash scripts\/aws\/branch-head\.sh "?refs\/heads\/(?:feat\/aws-native-phase-0-1|\$EXPECTED_BRANCH)"?/, name)
  }
  // Runner-only scripts are never run on the host.
  for (const { name, body } of ssmGenerators) {
    for (const runnerOnly of RUNNER_ONLY) assert.ok(!body.includes(`scripts/aws/${runnerOnly}`), `${name} runs ${runnerOnly} on the host`)
  }
})

test('every host checkout comes from a bundle the same step published, and every such job deletes it', () => {
  let sites = 0
  const withCheckout = ssmGenerators.filter(({ body }) => /host_checkout|host_update_worktree|cd "\$[A-Z_]+\/repo"|\.worktrees\//.test(body))
  for (const { name, text, body, args, at } of withCheckout) {
    sites += 1
    assert.match(body, /^\s*\{host_(?:checkout\('\$[A-Z_]+'|update_worktree\('\/home\/ssm-user\/SEA-N-SHORE-CODEX\/\.worktrees\/aws-native-phase-0-1'), sha\)\}$/m, `${name}: host checkout`)
    assert.match(body, /from ci_checkout import host_(?:checkout|update_worktree)\n/, name)
    // The published SHA is exactly the generator argument that becomes `sha`.
    const argv = [...args.split('>')[0].matchAll(/"(\$[A-Z_]+)"/g)].map((m) => m[1])
    const unpack = /^\s*(?:sha ?= ?sys\.argv\[1\]|([a-z_, *]+) = sys\.argv\[1:\])$/m.exec(body)
    assert.ok(unpack, `${name}: generator reads sha from argv`)
    const names = unpack[1] ? unpack[1].split(',').map((n) => n.trim()) : ['sha']
    const shaArg = argv[names.indexOf('sha')]
    assert.match(shaArg ?? '', /^\$(TRIGGER_SHA|SHA)$/, `${name}: sha argument`)
    const lineBefore = text.slice(0, at).trimEnd().split('\n').pop().trim()
    assert.match(lineBefore, new RegExp(`^bash "\\$GITHUB_WORKSPACE/scripts/aws/ci-checkout\\.sh" publish "\\${shaArg}"( --history)?$`), `${name}: publish right before the generator`)
  }
  assert.ok(sites >= 96, `found ${sites} host checkouts`)

  const cleanup = '      - name: Delete the host checkout bundle\n        if: always()\n        shell: bash\n        run: bash "$GITHUB_WORKSPACE/scripts/aws/ci-checkout.sh" cleanup\n'
  const callers = { 'aws-onboarding-e2e.yml': ['onboarding-e2e-feed-proof-ssm.sh', 'onboarding-e2e-sea-job-ssm.sh'] }
  let jobs = 0
  for (const { name, text } of workflows) {
    for (const job of jobBlocks(text)) {
      const publishes = job.includes('ci-checkout.sh" publish') || (callers[name] || []).some((s) => job.includes(`scripts/aws/${s}`))
      if (!publishes) continue
      jobs += 1
      const id = job.split('\n')[0].trim()
      assert.ok(job.trimEnd().endsWith(cleanup.trimEnd()), `${name}: ${id} ends with the cleanup step`)
      assert.match(job, /uses: actions\/checkout@/, `${name}: ${id} checks out the repository`)
      assert.doesNotMatch(job, /sparse-checkout|working-directory/, `${name}: ${id}`)
      if (job.includes('publish "$TRIGGER_SHA" --history')) assert.match(job, /uses: actions\/checkout@[^\n]+\n        with:\n          fetch-depth: 0\n/, `${name}: ${id}`)
    }
  }
  assert.ok(jobs >= 93, `found ${jobs} jobs that publish a bundle`)
  // Runners whose host scripts need history get the full branch history.
  for (const name of ['aws-social-events-infra.yml', 'aws-post-media-video-migration.yml', 'aws-remote-verify.yml']) {
    assert.match(workflows.find((w) => w.name === name).text, /ci-checkout\.sh" publish "\$TRIGGER_SHA" --history\n/, name)
  }
})

test('the deploy role writes only under ci-checkouts/; nothing secret is in the SSM text', () => {
  const runner = read('scripts/aws/ci-checkout.sh')
  const helper = read('scripts/aws/ci_checkout.py')
  assert.match(runner, /^BUCKET="sea-n-shore-staging-310356785722-migration"$/m)
  assert.match(runner, /key="ci-checkouts\/\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}-\$\{GITHUB_JOB\}-\$\{seq\}-\$\{sha\}"/)
  assert.doesNotMatch(runner, /get-object|list-objects|head-object/)
  assert.match(helper, /^BUCKET = 'sea-n-shore-staging-310356785722-migration'$/m)
  for (const source of [runner, helper, read('scripts/aws/branch-head.sh')]) {
    assert.doesNotMatch(source, /GH_TOKEN|GITHUB_TOKEN|github\.token|secrets\.|x-access-token|AWS_SECRET|aws_secret/i)
  }
})

// ---- Behaviour, on real git repositories with the AWS CLI stubbed by a local object store ----

const AWS_STUB = `#!/usr/bin/env python3
import json, os, sys, time, uuid, shutil
store = os.environ['STUB_STORE']
args = sys.argv[1:]
assert args[0] == 's3api', args
args = args[1:]
opts, pos, i = {}, [], 0
while i < len(args):
    if args[i].startswith('--'):
        opts[args[i][2:]] = args[i + 1]; i += 2
    else:
        pos.append(args[i]); i += 1
cmd = pos[0]
with open(os.path.join(store, 'calls.log'), 'a') as log:
    log.write(json.dumps([cmd, opts.get('bucket'), opts.get('key'), opts.get('version-id')]) + '\\n')
assert opts.get('bucket') == 'sea-n-shore-staging-310356785722-migration', opts
assert opts.get('region') == 'ap-south-1', opts
d = os.path.join(store, opts['key'].replace('/', '%'))
if cmd == 'put-object':
    os.makedirs(d, exist_ok=True)
    version = uuid.uuid4().hex
    shutil.copy(opts['body'], os.path.join(d, version))
    open(os.path.join(d, 'latest'), 'w').write(version)
    print(version)
elif cmd == 'get-object':
    version = opts.get('version-id') or (open(os.path.join(d, 'latest')).read() if os.path.exists(os.path.join(d, 'latest')) else '')
    src = os.path.join(d, version)
    if not version or not os.path.exists(src):
        sys.stderr.write('NoSuchKey\\n'); sys.exit(255)
    shutil.copy(src, pos[1])
    age = float(os.environ.get('STUB_HEAD_AGE', '0'))
    stamp = time.strftime('%Y-%m-%dT%H:%M:%S+00:00', time.gmtime(time.time() - age))
    print(json.dumps({'LastModified': stamp, 'VersionId': version}))
elif cmd == 'delete-object':
    p = os.path.join(d, opts['version-id'])
    if os.path.exists(p):
        os.remove(p)
else:
    sys.exit(2)
`

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'host-checkout-'))
  const sh = (cwd, cmd, env = {}) => execFileSync('bash', ['-c', cmd], { cwd, encoding: 'utf8', env: { ...process.env, ...env } }).trim()
  const origin = join(root, 'origin.git')
  const work = join(root, 'work')
  const bin = join(root, 'bin')
  const store = join(root, 'store')
  for (const d of [work, bin, store, join(root, 'runner-temp'), join(root, 'host')]) mkdirSync(d)
  writeFileSync(join(bin, 'aws'), AWS_STUB, { mode: 0o755 })
  sh(root, `git init -q --bare "${origin}"`)
  sh(work, 'git init -q -b feat/aws-native-phase-0-1 && git config user.email t@t && git config user.name t')
  writeFileSync(join(work, 'a.txt'), 'one\n')
  sh(work, 'git add -A && git commit -qm one')
  const first = sh(work, 'git rev-parse HEAD')
  writeFileSync(join(work, 'a.txt'), 'two\n')
  sh(work, `git commit -qam two && git remote add origin "${origin}" && git -c push.negotiate=false push -q origin HEAD:refs/heads/feat/aws-native-phase-0-1`)
  const sha = sh(work, 'git rev-parse HEAD')
  const env = { PATH: `${bin}:${process.env.PATH}`, STUB_STORE: store, RUNNER_TEMP: join(root, 'runner-temp'), GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1', GITHUB_JOB: 'apply', GITHUB_WORKSPACE: ROOT }
  const runner = (cmd, extra = {}) => spawnSync('bash', ['-c', cmd], { cwd: join(root, 'runner'), encoding: 'utf8', env: { ...process.env, ...env, ...extra } })
  const calls = () => (existsSync(join(store, 'calls.log')) ? readFileSync(join(store, 'calls.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [])
  const hostScript = (lines) => spawnSync('bash', ['-c', `set -euo pipefail\nWORK_DIR="${join(root, 'host')}"\n${lines}\ngit rev-parse HEAD; git remote get-url origin; echo "KEY=$SEA_N_SHORE_CHECKOUT_HEAD_KEY"`], { cwd: root, encoding: 'utf8', env: { ...process.env, ...env } })
  const helper = (fn, arg, sha2) => execFileSync('python3', ['-c', `import sys; sys.path.insert(0, ${JSON.stringify(join(ROOT, 'scripts/aws'))}); from ci_checkout import ${fn}; print(${fn}(sys.argv[1], sys.argv[2]))`, arg, sha2], { encoding: 'utf8', env: { ...process.env, ...env } })
  return { root, origin, work, store, env, sh, sha, first, runner, calls, hostScript, helper, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

test('publish → host checkout: exact SHA, bundle deleted, cleanup removes what the job wrote', () => {
  const f = fixture()
  try {
    f.sh(f.root, `git clone -q --depth 1 --branch feat/aws-native-phase-0-1 "file://${f.origin}" runner`)
    const published = f.runner(`bash "${ROOT}scripts/aws/ci-checkout.sh" publish ${f.sha}`)
    assert.equal(published.status, 0, published.stderr)
    assert.match(published.stdout, new RegExp(`CI_CHECKOUT_PUBLISHED key=ci-checkouts/42-1-apply-0-${f.sha} history=false`))
    const state = JSON.parse(readFileSync(join(f.env.RUNNER_TEMP, 'ci-checkout.json'), 'utf8'))
    assert.equal(state.length, 1)
    assert.equal(state[0].key, `ci-checkouts/42-1-apply-0-${f.sha}`)

    const lines = f.helper('host_checkout', '$WORK_DIR', f.sha)
    assert.doesNotMatch(lines, /github\.com[^\n]*(clone|fetch)|\bgit clone\b|ls-remote/)
    const host = f.hostScript(lines)
    assert.equal(host.status, 0, host.stderr)
    const [head, url, key] = host.stdout.trim().split('\n')
    assert.equal(head, f.sha)
    assert.equal(url, 'https://github.com/adityaps70/SEA-N-SHORE-CODEX.git')
    assert.equal(key, `KEY=ci-checkouts/42-1-apply-0-${f.sha}.head`)
    assert.equal(readFileSync(join(f.root, 'host/repo/a.txt'), 'utf8'), 'two\n')
    assert.equal(existsSync(join(f.root, 'host/repo.bundle')), false, 'local bundle removed')
    // The host downloaded exactly that version and deleted it straight away.
    const hostCalls = f.calls().filter(([cmd, , k]) => cmd !== 'put-object' && k.endsWith('.bundle'))
    assert.deepEqual(hostCalls.map(([cmd, , k, v]) => [cmd, k, v]), [
      ['get-object', `${state[0].key}.bundle`, state[0].version],
      ['delete-object', `${state[0].key}.bundle`, state[0].version],
    ])

    // The head publisher wrote the live branch head; cleanup stops it and deletes everything this job wrote.
    for (let i = 0; i < 50 && !f.calls().some(([cmd, , k]) => cmd === 'put-object' && k.endsWith('.head')); i++) execFileSync('sleep', ['0.2'])
    const done = f.runner(`bash "${ROOT}scripts/aws/ci-checkout.sh" cleanup`)
    assert.equal(done.status, 0, done.stderr)
    assert.match(done.stdout, /CI_CHECKOUT_CLEANUP deleted=1/)
    const left = readdirSync(f.store).filter((d) => d !== 'calls.log').flatMap((d) => readdirSync(join(f.store, d)).filter((v) => v !== 'latest'))
    assert.deepEqual(left, [], 'no object versions left behind')
    assert.equal(existsSync(join(f.env.RUNNER_TEMP, 'ci-checkout.json')), false)
  } finally {
    f.runner(`bash "${ROOT}scripts/aws/ci-checkout.sh" cleanup`)
    f.cleanup()
  }
})

test('the host refuses a bundle that does not contain the expected SHA, and publish refuses a runner not at the SHA', () => {
  const f = fixture()
  try {
    f.sh(f.root, `git clone -q --depth 1 --branch feat/aws-native-phase-0-1 "file://${f.origin}" runner`)
    const wrong = f.runner(`bash "${ROOT}scripts/aws/ci-checkout.sh" publish ${f.first}`)
    assert.notEqual(wrong.status, 0)
    assert.match(wrong.stderr, /not at/)
    assert.equal(f.runner(`bash "${ROOT}scripts/aws/ci-checkout.sh" publish ${f.sha}`).status, 0)
    assert.throws(() => f.helper('host_checkout', '$WORK_DIR', f.first), /not for this SHA/)
    // Swap the stored object for a bundle of another commit: the host's checkout of the exact SHA fails.
    const state = JSON.parse(readFileSync(join(f.env.RUNNER_TEMP, 'ci-checkout.json'), 'utf8'))[0]
    f.sh(f.work, `git update-ref refs/ci-checkout ${f.first} && git bundle create -q other.bundle refs/ci-checkout`)
    const stored = join(f.store, `${state.key}.bundle`.replace(/\//g, '%'), state.version)
    writeFileSync(stored, readFileSync(join(f.work, 'other.bundle')))
    const host = f.hostScript(f.helper('host_checkout', '$WORK_DIR', f.sha))
    assert.notEqual(host.status, 0, 'a bundle without the SHA must not check out')
  } finally {
    f.runner(`bash "${ROOT}scripts/aws/ci-checkout.sh" cleanup`)
    f.cleanup()
  }
})

test('--history ships the branch history and origin ref (ancestry checks keep working)', () => {
  const f = fixture()
  try {
    f.sh(f.root, `git clone -q --branch feat/aws-native-phase-0-1 "file://${f.origin}" runner`)
    const published = f.runner(`bash "${ROOT}scripts/aws/ci-checkout.sh" publish ${f.sha} --history`)
    assert.equal(published.status, 0, published.stderr)
    const host = f.hostScript(`${f.helper('host_checkout', '$WORK_DIR', f.sha)}\ngit merge-base --is-ancestor ${f.first} HEAD\ngit show-ref --verify --quiet refs/remotes/origin/feat/aws-native-phase-0-1\ngit merge-base --is-ancestor ${f.sha} origin/feat/aws-native-phase-0-1`)
    assert.equal(host.status, 0, host.stderr)
    assert.throws(() => f.helper('host_update_worktree', '/x', f.first))
    // A shallow runner checkout cannot publish history.
    f.runner(`bash "${ROOT}scripts/aws/ci-checkout.sh" cleanup`)
    rmSync(join(f.root, 'runner'), { recursive: true, force: true })
    f.sh(f.root, `git clone -q --depth 1 --branch feat/aws-native-phase-0-1 "file://${f.origin}" runner`)
    const shallow = f.runner(`bash "${ROOT}scripts/aws/ci-checkout.sh" publish ${f.sha} --history`)
    assert.notEqual(shallow.status, 0)
    assert.match(shallow.stderr, /fetch-depth: 0/)
  } finally {
    f.runner(`bash "${ROOT}scripts/aws/ci-checkout.sh" cleanup`)
    f.cleanup()
  }
})

test('branch-head.sh: a fresh runner-published head passes, a moved branch fails the check, a stale or missing head refuses', () => {
  const f = fixture()
  try {
    const key = `ci-checkouts/42-1-apply-0-${f.sha}`
    const put = (sha) => {
      writeFileSync(join(f.root, 'head'), `${sha}\trefs/heads/feat/aws-native-phase-0-1\n`)
      execFileSync('aws', ['s3api', '--region', 'ap-south-1', 'put-object', '--bucket', 'sea-n-shore-staging-310356785722-migration', '--key', `${key}.head`, '--body', join(f.root, 'head')], { env: { ...process.env, ...f.env } })
    }
    const check = (extra = {}) => spawnSync('bash', ['-c', `[[ "$(bash scripts/aws/branch-head.sh refs/heads/feat/aws-native-phase-0-1 | cut -f1)" == "${f.sha}" ]]`], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...f.env, SEA_N_SHORE_CHECKOUT_HEAD_KEY: `${key}.head`, SEA_N_SHORE_BRANCH_HEAD_ATTEMPTS: '1', ...extra } })
    put(f.sha)
    assert.equal(check().status, 0, check().stderr)
    put(f.first)
    assert.notEqual(check().status, 0, 'moved branch must fail the check')
    put(f.sha)
    assert.notEqual(check({ STUB_HEAD_AGE: '60' }).status, 0, 'stale head must refuse')
    assert.notEqual(check({ SEA_N_SHORE_CHECKOUT_HEAD_KEY: '' }).status, 0, 'no key must refuse')
    assert.notEqual(check({ SEA_N_SHORE_CHECKOUT_HEAD_KEY: `ci-checkouts/42-1-apply-1-${f.sha}.head` }).status, 0, 'missing head must refuse')
    const other = spawnSync('bash', ['scripts/aws/branch-head.sh', 'refs/heads/main'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...f.env, SEA_N_SHORE_CHECKOUT_HEAD_KEY: `${key}.head` } })
    assert.notEqual(other.status, 0)
  } finally {
    f.cleanup()
  }
})

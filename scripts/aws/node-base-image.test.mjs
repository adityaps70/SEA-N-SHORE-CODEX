// Round I: every image build starts from one pinned node base image. Deploy builds use our own copy in private ECR
// (copied once per digest from Amazon ECR Public, scripts/aws/node-base-image.sh); PR CI pulls the same digest from
// ECR Public or Google's mirror of the official image.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const env = read('./node-base-image.env')
const script = read('./node-base-image.sh')
const dockerfile = read('../../Dockerfile')
const deploy = read('../../.github/workflows/aws-staging-deploy.yml')
const social = read('../../.github/workflows/aws-social-events-image.yml')
const ci = read('../../.github/workflows/aws-infra-ci.yml')

const value = (name) => env.match(new RegExp(`^${name}=(.+)$`, 'm'))?.[1]
const DIGEST = value('NODE_BASE_DIGEST')
const REGISTRY = '310356785722.dkr.ecr.ap-south-1.amazonaws.com'
const PRIVATE = `${REGISTRY}/sea-n-shore-base/node`
const PUBLIC = 'public.ecr.aws/docker/library/node'

test('one pin: the env file and the Dockerfile default name the same digest of node:22-bookworm-slim', () => {
  assert.match(DIGEST, /^sha256:[0-9a-f]{64}$/)
  assert.equal(value('NODE_BASE_TAG'), '22-bookworm-slim')
  assert.equal(value('NODE_BASE_REPOSITORY'), 'sea-n-shore-base/node')
  assert.match(dockerfile, new RegExp(`^ARG NODE_BASE_IMAGE=public\\.ecr\\.aws/docker/library/node:22-bookworm-slim@${DIGEST}$`, 'm'))
  const froms = [...dockerfile.matchAll(/^FROM\s+(\S+)/gm)].map((match) => match[1])
  assert.equal(froms.length, 3)
  for (const from of froms) assert.equal(from, '${NODE_BASE_IMAGE}')
  // The ARG comes before the first FROM, so every stage can use it.
  assert.ok(dockerfile.indexOf('ARG NODE_BASE_IMAGE=') < dockerfile.indexOf('FROM '))
  assert.doesNotMatch(dockerfile, /^#\s*syntax\s*=/im)
})

function run(skopeoBody, { registry = REGISTRY, withSkopeo = true } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'node-base-image-'))
  try {
    if (withSkopeo) {
      writeFileSync(join(dir, 'skopeo'), `#!/usr/bin/env bash\necho "skopeo $*" >> "${dir}/calls"\n${skopeoBody}\n`)
      chmodSync(join(dir, 'skopeo'), 0o755)
    } else {
      // GitHub's runners have skopeo in /usr/bin: give the script a PATH holding only what it needs besides skopeo.
      symlinkSync(spawnSync('bash', ['-c', 'command -v dirname'], { encoding: 'utf8' }).stdout.trim(), join(dir, 'dirname'))
    }
    writeFileSync(join(dir, 'calls'), '')
    writeFileSync(join(dir, 'github-env'), '')
    const bash = spawnSync('bash', ['-c', 'command -v bash'], { encoding: 'utf8' }).stdout.trim()
    const result = spawnSync(bash, [new URL('./node-base-image.sh', import.meta.url).pathname, registry], {
      encoding: 'utf8',
      env: { PATH: withSkopeo ? `${dir}:/usr/bin:/bin` : dir, GITHUB_ENV: join(dir, 'github-env') },
    })
    return {
      status: result.status,
      output: `${result.stdout}${result.stderr}`,
      calls: readFileSync(join(dir, 'calls'), 'utf8').trim().split('\n').filter(Boolean),
      githubEnv: readFileSync(join(dir, 'github-env'), 'utf8'),
    }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

test('our copy is there: build from it, copy nothing', () => {
  const result = run('exit 0')
  assert.equal(result.status, 0, result.output)
  assert.deepEqual(result.calls, [`skopeo inspect --raw docker://${PRIVATE}@${DIGEST}`])
  assert.equal(result.githubEnv, `NODE_BASE_IMAGE=${PRIVATE}@${DIGEST}\n`)
  assert.match(result.output, /NODE_BASE_SOURCE=private-ecr/)
})

test('our copy is missing: copy the pinned manifest from ECR Public with its digest preserved, then build from it', () => {
  // The first inspect misses; the copy and the check after it succeed.
  const result = run(`if [[ "$1" == inspect && ! -e "$(dirname "$0")/copied" ]]; then exit 1; fi; if [[ "$1" == copy ]]; then touch "$(dirname "$0")/copied"; fi`)
  assert.equal(result.status, 0, result.output)
  assert.equal(result.calls.length, 3)
  assert.equal(result.calls[1], `skopeo copy --quiet --retry-times 2 --preserve-digests docker://${PUBLIC}@${DIGEST} docker://${PRIVATE}:22-bookworm-slim-${DIGEST.slice(7, 19)}`)
  assert.equal(result.calls[2], `skopeo inspect --raw docker://${PRIVATE}@${DIGEST}`)
  assert.equal(result.githubEnv, `NODE_BASE_IMAGE=${PRIVATE}@${DIGEST}\n`)
  assert.match(result.output, new RegExp(`NODE_BASE_COPIED=sea-n-shore-base/node:22-bookworm-slim-${DIGEST.slice(7, 19)}`))
})

test('the copy fails (no repository yet, or ECR Public refuses): warn and build from ECR Public at the same digest', () => {
  const result = run('exit 1')
  assert.equal(result.status, 0, result.output)
  assert.equal(result.calls.length, 2)
  assert.match(result.output, /::warning::Could not copy the node base image/)
  assert.equal(result.githubEnv, `NODE_BASE_IMAGE=${PUBLIC}@${DIGEST}\n`)
  assert.match(result.output, /NODE_BASE_SOURCE=ecr-public/)
})

test('without skopeo the build still uses the pinned digest from ECR Public', () => {
  const result = run('', { withSkopeo: false })
  assert.equal(result.status, 0, result.output)
  assert.match(result.output, /::warning::skopeo is not installed/)
  assert.equal(result.githubEnv, `NODE_BASE_IMAGE=${PUBLIC}@${DIGEST}\n`)
})

test('only a private ECR registry is accepted, and the script only reads and pushes', () => {
  for (const registry of ['', 'public.ecr.aws', 'docker.io', `${REGISTRY}/other`]) {
    const result = run('exit 0', { registry })
    assert.equal(result.status, 1, registry)
    assert.deepEqual(result.calls, [])
  }
  assert.doesNotMatch(script, /skopeo delete|batch-delete-image|docker (rmi|push)|--src-creds|--dest-creds|password/i)
})

test('the deploy and social image builds use our copy; PR CI uses the same digest', () => {
  const signIn = deploy.indexOf('- name: Sign in to Amazon ECR Public for the base image')
  const copy = deploy.indexOf('- name: Use our own copy of the node base image')
  const build = deploy.indexOf('- name: Build and push immutable application image')
  assert.ok(deploy.indexOf('- name: Login to Amazon ECR') < signIn && signIn < copy && copy < build)
  assert.match(deploy.slice(copy, build), /REGISTRY: \$\{\{ steps\.ecr\.outputs\.registry \}\}\n\s+run: bash scripts\/aws\/node-base-image\.sh "\$REGISTRY"\n/)
  assert.match(deploy.slice(build), /docker build \\\n\s+--build-arg NODE_BASE_IMAGE="\$NODE_BASE_IMAGE" \\\n/)

  const socialCopy = social.indexOf('- name: Use our own copy of the node base image')
  const socialBuild = social.indexOf('- name: Build and push immutable social worker image')
  assert.ok(social.indexOf('- name: Login to Amazon ECR') < socialCopy && socialCopy < socialBuild)
  assert.match(social.slice(socialBuild), /docker build --build-arg NODE_BASE_IMAGE="\$NODE_BASE_IMAGE" /)
  assert.match(social.split('\njobs:')[0], /- scripts\/aws\/node-base-image\.env\n\s+- scripts\/aws\/node-base-image\.sh\n/)

  const pull = ci.indexOf('- name: Pull the node base image')
  const ciBuild = ci.indexOf('- name: Build production image')
  const step = ci.slice(pull, ciBuild)
  assert.match(step, /source scripts\/aws\/node-base-image\.env\n/)
  assert.match(step, /image="public\.ecr\.aws\/docker\/library\/node@\$NODE_BASE_DIGEST"\n/)
  assert.match(step, /image="mirror\.gcr\.io\/library\/node@\$NODE_BASE_DIGEST"\n/)
  assert.equal((step.match(/echo "NODE_BASE_IMAGE=\$image" >> "\$GITHUB_ENV"/g) || []).length, 2)
  assert.match(ci.slice(ciBuild, ciBuild + 300), /--build-arg NODE_BASE_IMAGE="\$NODE_BASE_IMAGE" \\\n/)
  assert.doesNotMatch(ci.slice(ciBuild, ciBuild + 300), /--pull/)
})

const branch = 'feat/aws-native-phase-0-1'
const repo = process.env.GITHUB_REPOSITORY || 'adityaps70/SEA-N-SHORE-CODEX'
const token = process.env.GITHUB_TOKEN
const apiBase = 'https://api.github.com'
const approvalPhrase = 'I_APPROVE_MEMBERSHIP_STAGING_ONE_SHOT'
const launchActionPath = 'scripts/aws/membership-launch-action.txt'

const guards = {
  migration: {
    path: 'scripts/aws/membership-access-migration-action.txt',
    armed: 'migrate-once',
    workflow: 'AWS Membership Access Migration',
    workflowFile: 'aws-membership-access-migration.yml',
  },
  deploy: {
    path: 'scripts/aws/staging-deploy-action.txt',
    armed: 'deploy-once',
    workflow: 'AWS Staging Deploy',
    workflowFile: 'aws-staging-deploy.yml',
  },
  e2e: {
    path: 'scripts/aws/onboarding-e2e-action.txt',
    armed: 'run-once',
    workflow: 'AWS Onboarding E2E',
    workflowFile: 'aws-onboarding-e2e.yml',
  },
}

function assertToken() {
  if (!token) throw new Error('GITHUB_TOKEN is required')
}

function assertSha(value, label = 'expectedSha') {
  if (!/^[0-9a-f]{40}$/.test(value || '')) throw new Error(`${label} must be an exact 40-character commit SHA`)
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function api(path, options = {}) {
  assertToken()
  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(options.headers || {}),
    },
  })
  const text = await response.text()
  let body = null
  if (text) {
    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }
  if (!response.ok) {
    throw new Error(`GitHub API ${options.method || 'GET'} ${path} failed (${response.status}): ${typeof body === 'string' ? body : JSON.stringify(body)}`)
  }
  return body
}

async function getBranchHead() {
  const data = await api(`/repos/${repo}/branches/${branch}`)
  const sha = data?.commit?.sha
  assertSha(sha, 'branch head')
  return sha
}

async function assertBranchHead(expectedSha) {
  const live = await getBranchHead()
  if (live !== expectedSha) {
    throw new Error(`Branch moved: expected ${expectedSha}, live ${live}`)
  }
  return live
}

async function waitForWorkflowRun(name, sha, timeoutMs = 30 * 60 * 1000, options = {}) {
  assertSha(sha, 'workflow head_sha')
  const started = Date.now()
  const notBefore = Number(options.notBefore || 0)
  const requiredEvent = options.event || null

  while (Date.now() - started < timeoutMs) {
    const data = await api(`/repos/${repo}/actions/runs?head_sha=${sha}&per_page=100`)
    const runs = Array.isArray(data?.workflow_runs) ? data.workflow_runs : []
    const run = runs
      .filter((candidate) => candidate?.name === name)
      .filter((candidate) => !requiredEvent || candidate?.event === requiredEvent)
      .filter((candidate) => !notBefore || new Date(candidate?.created_at || 0).getTime() >= notBefore)
      .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())[0]

    if (run?.status === 'completed') {
      if (run.conclusion !== 'success') {
        throw new Error(`${name} failed for ${sha}: ${run.conclusion || 'unknown conclusion'}`)
      }
      return run
    }

    await sleep(10_000)
  }
  throw new Error(`Timed out waiting for ${name} on head_sha=${sha}`)
}

async function waitForInfrastructureCi(sha) {
  return waitForWorkflowRun('AWS Infrastructure CI', sha)
}

async function getCommit(sha) {
  return api(`/repos/${repo}/git/commits/${sha}`)
}

async function commitFiles(expectedHead, files, message) {
  await assertBranchHead(expectedHead)
  const commit = await getCommit(expectedHead)
  const baseTree = commit?.tree?.sha
  assertSha(baseTree, 'base tree')

  const tree = await api(`/repos/${repo}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTree,
      tree: files.map(({ path, content }) => ({
        path,
        mode: '100644',
        type: 'blob',
        content: content.endsWith('\n') ? content : `${content}\n`,
      })),
    }),
  })
  assertSha(tree?.sha, 'created tree')

  const nextCommit = await api(`/repos/${repo}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: tree.sha,
      parents: [expectedHead],
    }),
  })
  assertSha(nextCommit?.sha, 'created commit')

  await api(`/repos/${repo}/git/refs/heads/${branch}`, {
    method: 'PATCH',
    body: JSON.stringify({ sha: nextCommit.sha, force: false }),
  })

  await assertBranchHead(nextCommit.sha)
  return nextCommit.sha
}

async function getRemoteFile(path) {
  const data = await api(`/repos/${repo}/contents/${encodeURIComponent(path).replaceAll('%2F', '/')}?ref=${encodeURIComponent(branch)}`)
  if (!data?.content || data.encoding !== 'base64') throw new Error(`Could not read ${path}`)
  return Buffer.from(data.content.replace(/\n/g, ''), 'base64').toString('utf8').trim()
}

async function assertAllGuardsPlan() {
  for (const guard of Object.values(guards)) {
    const value = await getRemoteFile(guard.path)
    if (value !== 'plan') throw new Error(`${guard.path} must be plan before launch; found ${value}`)
  }
}

async function dispatchWorkflow(key, expectedSha) {
  const guard = guards[key]
  if (!guard) throw new Error(`Unknown workflow stage ${key}`)

  await assertBranchHead(expectedSha)
  const dispatchedAt = Date.now() - 5_000

  const inputs = key === 'migration'
    ? {
        requested_action: 'migrate-once',
        expected_sha: expectedSha,
        confirmation: approvalPhrase,
      }
    : key === 'deploy'
      ? {
          deploy_to_ecs: 'true',
          expected_sha: expectedSha,
          confirmation: approvalPhrase,
        }
      : {
          requested_action: 'run-once',
          expected_sha: expectedSha,
          confirmation: approvalPhrase,
        }

  await api(`/repos/${repo}/actions/workflows/${guard.workflowFile}/dispatches`, {
    method: 'POST',
    body: JSON.stringify({
      ref: branch,
      inputs,
    }),
  })

  const run = await waitForWorkflowRun(
    guard.workflow,
    expectedSha,
    45 * 60 * 1000,
    { event: 'workflow_dispatch', notBefore: dispatchedAt },
  )

  await assertBranchHead(expectedSha)
  return run
}

async function rearmAllGuards() {
  const expectedHead = await getBranchHead()
  const files = []

  for (const guard of Object.values(guards)) {
    const value = await getRemoteFile(guard.path)
    if (value !== 'plan') files.push({ path: guard.path, content: 'plan' })
  }

  const launchAction = await getRemoteFile(launchActionPath)
  if (launchAction !== 'plan') files.push({ path: launchActionPath, content: 'plan' })

  if (!files.length) return expectedHead

  return commitFiles(
    expectedHead,
    files,
    'ops: rearm membership staging execution guards',
  )
}

async function preflight(expectedSha) {
  assertSha(expectedSha)
  await assertBranchHead(expectedSha)
  await assertAllGuardsPlan()
  await waitForInfrastructureCi(expectedSha)
  return true
}

async function execute(expectedSha, confirmation) {
  if (confirmation !== approvalPhrase) throw new Error('Explicit launch approval phrase is required')
  await preflight(expectedSha)

  await dispatchWorkflow('migration', expectedSha)
  await dispatchWorkflow('deploy', expectedSha)
  await dispatchWorkflow('e2e', expectedSha)

  await assertBranchHead(expectedSha)
  await assertAllGuardsPlan()
  return expectedSha
}

const [mode, expectedSha = '', confirmation = ''] = process.argv.slice(2)

if (mode === 'preflight') {
  await preflight(expectedSha)
  console.log('MEMBERSHIP_LAUNCH_SEQUENCE_PREFLIGHT_VERIFIED=true')
} else if (mode === 'execute') {
  const finalHead = await execute(expectedSha, confirmation)
  console.log(`MEMBERSHIP_LAUNCH_SEQUENCE_EXECUTION_VERIFIED=true final_head=${finalHead}`)
} else if (mode === 'rearm') {
  const finalHead = await rearmAllGuards()
  console.log(`MEMBERSHIP_LAUNCH_SEQUENCE_REARMED=true final_head=${finalHead}`)
} else {
  throw new Error('Usage: node scripts/aws/membership-launch-sequence.mjs <preflight|execute|rearm> [expectedSha] [confirmation]')
}

export {
  approvalPhrase,
  assertAllGuardsPlan,
  commitFiles,
  dispatchWorkflow,
  execute,
  preflight,
  rearmAllGuards,
  waitForWorkflowRun,
}

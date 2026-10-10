import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHmac, randomBytes } from 'node:crypto'
import { appendFileSync, chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'

// Contract test for the Resend delivery webhook runner (scripts/aws/resend-delivery-webhook.py). It runs the real
// script against a local fake of the Resend API, a fake of the deployed webhook endpoint (which checks Svix
// signatures like the app does) and a fake `aws` CLI that keeps Secrets Manager in a file and logs its arguments.
// The API key and signing secret here are made-up test values.

const run = promisify(execFile)
const SCRIPT = new URL('./resend-delivery-webhook.py', import.meta.url).pathname
const ENDPOINT = 'https://seanshore.in/api/email/resend/webhook'
const EVENTS = ['email.delivered', 'email.bounced', 'email.complained', 'email.delivery_delayed', 'email.failed', 'email.suppressed']
const API_KEY = 're_test_' + randomBytes(8).toString('hex')

function fakeWorld(order, { endpointLive = true, keyCanManage = true, tracking = { open: true, click: true } } = {}) {
  const state = { webhooks: [], requests: [], domain: { id: 'dom-1', name: 'mail.seanshore.in', open_tracking: tracking.open, click_tracking: tracking.click }, storedSecret: null }
  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      const send = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)) }
      const url = new URL(req.url, 'http://127.0.0.1')
      state.requests.push({ method: req.method, path: url.pathname, body })
      appendFileSync(order, `resend ${req.method} ${url.pathname}\n`)
      if (url.pathname === '/api/email/resend/webhook') {
        if (!endpointLive) return send(404, {})
        const secret = state.storedSecret
        if (!secret) return send(503, { error: 'webhook_not_configured' })
        const id = req.headers['svix-id']; const ts = req.headers['svix-timestamp']; const sig = req.headers['svix-signature']
        const expected = 'v1,' + createHmac('sha256', Buffer.from(secret.slice(6), 'base64')).update(`${id}.${ts}.${body}`).digest('base64')
        return sig === expected ? send(200, { ok: true, status: 'ignored' }) : send(400, { error: 'invalid_signature' })
      }
      if (req.headers.authorization !== `Bearer ${API_KEY}`) return send(401, { message: 'bad key' })
      if (url.pathname.startsWith('/webhooks') && !keyCanManage) return send(401, { name: 'restricted_api_key', message: 'Sending only' })
      if (req.method === 'GET' && url.pathname === '/webhooks') return send(200, { object: 'list', has_more: false, data: state.webhooks.map(({ id, endpoint, events, status }) => ({ id, endpoint, events, status })) })
      if (req.method === 'POST' && url.pathname === '/webhooks') {
        const input = JSON.parse(body)
        const hook = { id: `wh-${state.webhooks.length + 1}`, endpoint: input.endpoint, events: input.events, status: 'enabled', signing_secret: 'whsec_' + randomBytes(24).toString('base64') }
        state.webhooks.push(hook)
        return send(200, { object: 'webhook', id: hook.id, signing_secret: hook.signing_secret })
      }
      const hookMatch = /^\/webhooks\/([\w-]+)$/.exec(url.pathname)
      if (req.method === 'GET' && hookMatch) return send(200, state.webhooks.find((hook) => hook.id === hookMatch[1]))
      if (req.method === 'GET' && url.pathname === '/domains') return send(200, { data: [{ id: 'dom-0', name: 'other.example' }, { id: state.domain.id, name: state.domain.name }] })
      if (url.pathname === `/domains/${state.domain.id}`) {
        if (req.method === 'PATCH') Object.assign(state.domain, JSON.parse(body))
        return send(200, state.domain)
      }
      send(404, { message: 'not found' })
    })
  })
  return { server, state }
}

function fakeAws(dir, order) {
  const store = path.join(dir, 'secrets.json')
  const log = path.join(dir, 'aws-argv.log')
  writeFileSync(store, JSON.stringify({ 'sea-n-shore/resend': JSON.stringify({ RESEND_API_KEY: API_KEY }) }))
  writeFileSync(path.join(dir, 'aws.py'), `
import json, sys
store, log = ${JSON.stringify(store)}, ${JSON.stringify(log)}
args = sys.argv[1:]
open(log, 'a').write(json.dumps(args) + '\\n')
open(${JSON.stringify(order)}, 'a').write('aws ' + args[1] + '\\n')
secrets = json.load(open(store))
def opt(name):
    return args[args.index(name) + 1] if name in args else None
def read_value(value):
    return open(value[len('file://'):]).read() if value.startswith('file://') else value
op = args[1]
sid = opt('--secret-id') or opt('--name')
if op == 'get-secret-value':
    if sid not in secrets: sys.stderr.write('ResourceNotFoundException'); sys.exit(254)
    print(secrets[sid])
elif op == 'describe-secret':
    if sid not in secrets: sys.stderr.write('An error occurred (ResourceNotFoundException)'); sys.exit(254)
    print(json.dumps({'Name': sid, 'ARN': 'arn:aws:secretsmanager:ap-south-1:310356785722:secret:' + sid + '-AbCdEf'}))
elif op == 'create-secret':
    if sid in secrets: sys.stderr.write('ResourceExistsException'); sys.exit(254)
    secrets[sid] = read_value(opt('--secret-string'))
    print(json.dumps({'Name': sid}))
elif op == 'put-secret-value':
    if sid not in secrets: sys.stderr.write('ResourceNotFoundException'); sys.exit(254)
    secrets[sid] = read_value(opt('--secret-string'))
    print(json.dumps({'Name': sid}))
else:
    sys.stderr.write('unexpected aws call ' + ' '.join(args)); sys.exit(2)
json.dump(secrets, open(store, 'w'))
`)
  writeFileSync(path.join(dir, 'aws'), `#!/usr/bin/env bash\nexec python3 ${JSON.stringify(path.join(dir, 'aws.py'))} "$@"\n`)
  chmodSync(path.join(dir, 'aws'), 0o755)
  return { bin: dir, store, log, secrets: () => JSON.parse(readFileSync(store, 'utf8')), argv: () => readFileSync(log, 'utf8'), order: () => readFileSync(order, 'utf8').trim().split('\n') }
}

async function withWorld(options, body) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'resend-webhook-'))
  const order = path.join(dir, 'order.log')
  writeFileSync(order, '')
  const world = fakeWorld(order, options)
  await new Promise((resolve) => world.server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${world.server.address().port}`
  const aws = fakeAws(dir, order)
  // The endpoint fake reads the secret the runner stored, as the app would.
  const sync = setInterval(() => {
    try {
      const value = aws.secrets()['sea-n-shore/resend-webhook-signing']
      world.state.storedSecret = value ? JSON.parse(value).signing_secret ?? null : null
    } catch { /* not written yet */ }
  }, 20)
  const exec = async (action, env = {}) => {
    try {
      const result = await run('python3', ['-I', SCRIPT, action], {
        env: { PATH: `${aws.bin}:${process.env.PATH}`, RESEND_DELIVERY_WEBHOOK_TEST_RESEND_API: base, RESEND_DELIVERY_WEBHOOK_TEST_SITE: base, ...env },
        timeout: 60_000,
      })
      return { code: 0, ...result }
    } catch (error) {
      return { code: error.code ?? 1, stdout: error.stdout ?? '', stderr: error.stderr ?? '' }
    }
  }
  try {
    await body({ exec, state: world.state, aws })
  } finally {
    clearInterval(sync)
    world.server.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

function assertNoSecrets(texts, state) {
  const secrets = [API_KEY, ...state.webhooks.map((hook) => hook.signing_secret)]
  for (const text of texts) for (const secret of secrets) assert.ok(!text.includes(secret), 'a secret value was printed or passed on a command line')
}

test('plan only reads: it reports what exists and creates nothing', async () => {
  await withWorld({}, async ({ exec, state, aws }) => {
    const result = await exec('plan')
    assert.equal(result.code, 0, result.stderr)
    assert.match(result.stdout, /^RESEND_DELIVERY_WEBHOOK_EXISTING_WEBHOOK=false$/m)
    assert.match(result.stdout, /^RESEND_DELIVERY_WEBHOOK_DOMAIN_OPEN_TRACKING=true$/m)
    assert.match(result.stdout, /^RESEND_DELIVERY_WEBHOOK_ENDPOINT_LIVE=true$/m)
    assert.match(result.stdout, /^RESEND_DELIVERY_WEBHOOK_WOULD=configure$/m)
    assert.equal(result.stdout.trim().split('\n').at(-1), 'RESEND_DELIVERY_WEBHOOK_PLAN_ONLY_NO_APPLY')
    assert.equal(state.webhooks.length, 0)
    assert.ok(!state.requests.some((request) => request.method === 'POST' && request.path === '/webhooks'))
    assert.ok(!state.requests.some((request) => request.method === 'PATCH'))
    assert.ok(!aws.argv().includes('create-secret') && !aws.argv().includes('put-secret-value'))
    assertNoSecrets([result.stdout, result.stderr, aws.argv()], state)
  })
})

test('apply refuses before creating anything while the endpoint is not deployed', async () => {
  await withWorld({ endpointLive: false }, async ({ exec, state, aws }) => {
    const result = await exec('apply-once')
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /not deployed yet/)
    assert.equal(state.webhooks.length, 0)
    assert.ok(!aws.argv().includes('create-secret'))
  })
})

test('apply creates one webhook for the six events, stores its secret without printing it, turns tracking off and proves the endpoint', async () => {
  await withWorld({}, async ({ exec, state, aws }) => {
    const result = await exec('apply-once')
    assert.equal(result.code, 0, result.stderr)
    assert.equal(state.webhooks.length, 1)
    assert.equal(state.webhooks[0].endpoint, ENDPOINT)
    assert.deepEqual(state.webhooks[0].events, EVENTS)

    const stored = JSON.parse(aws.secrets()['sea-n-shore/resend-webhook-signing'])
    assert.deepEqual(stored, { signing_secret: state.webhooks[0].signing_secret, webhook_id: state.webhooks[0].id })
    const calls = aws.argv().trim().split('\n').map((line) => JSON.parse(line))
    const order = aws.order()
    assert.ok(order.indexOf('aws create-secret') >= 0, 'the secret is created')
    assert.ok(order.indexOf('aws create-secret') < order.indexOf('resend POST /webhooks'), 'the secret exists before the webhook is created')
    assert.ok(order.indexOf('resend POST /webhooks') < order.indexOf('aws put-secret-value'), 'the signing secret is stored after the webhook is created')
    assert.ok(calls.filter((args) => args.includes('--secret-string')).every((args) => args[args.indexOf('--secret-string') + 1].startsWith('file://')))

    assert.equal(state.domain.open_tracking, false)
    assert.equal(state.domain.click_tracking, false)
    assert.match(result.stdout, /^RESEND_DELIVERY_WEBHOOK_SIGNED_PROBE_ACCEPTED=true$/m)
    assert.match(result.stdout, /^RESEND_DELIVERY_WEBHOOK_UNSIGNED_PROBE_REFUSED=true$/m)
    assert.equal(result.stdout.trim().split('\n').at(-1), 'RESEND_DELIVERY_WEBHOOK_APPLY_VERIFIED=true')
    assertNoSecrets([result.stdout, result.stderr, aws.argv()], state)

    // A second run reuses the webhook and changes nothing; a plan afterwards has nothing to do.
    const again = await exec('apply-once')
    assert.equal(again.code, 0, again.stderr)
    assert.equal(state.webhooks.length, 1)
    assert.match(again.stdout, /^RESEND_DELIVERY_WEBHOOK_WEBHOOK_CREATED=false$/m)
    const plan = await exec('plan')
    assert.match(plan.stdout, /^RESEND_DELIVERY_WEBHOOK_WOULD=nothing$/m)
    assertNoSecrets([again.stdout, again.stderr, plan.stdout, aws.argv()], state)
  })
})

test('a sending-only Resend key stops the run with a clear reason', async () => {
  await withWorld({ keyCanManage: false }, async ({ exec, state }) => {
    const result = await exec('apply-once')
    assert.notEqual(result.code, 0)
    assert.match(result.stdout, /^RESEND_DELIVERY_WEBHOOK_KEY_CANNOT_MANAGE=true$/m)
    assert.match(result.stderr, /needs full access/)
    assert.equal(state.webhooks.length, 0)
  })
})

test('the test overrides only accept a local server', async () => {
  await withWorld({}, async ({ exec }) => {
    const result = await exec('plan', { RESEND_DELIVERY_WEBHOOK_TEST_RESEND_API: 'https://resend.example' })
    assert.notEqual(result.code, 0)
    assert.match(result.stderr, /local test server/)
  })
})

test('the workflow is guarded like every other AWS-changing runner', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/aws-resend-delivery-webhook.yml', import.meta.url), 'utf8')
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/resend-delivery-webhook-action\.txt\n\s+shell: bash\n\s+run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /^ {4}environment: staging-apply$/m)
  assert.match(workflow, /bash scripts\/aws\/resend-delivery-webhook\.sh/)
  assert.match(workflow, /grep -qx 'RESEND_DELIVERY_WEBHOOK_APPLY_VERIFIED=true'/)
  assert.equal(readFileSync(new URL('./resend-delivery-webhook-action.txt', import.meta.url), 'utf8'), 'plan\n')
})

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { promisify } from 'node:util'
import { guardAction } from './guard-value.mjs'

// Contract test for the domain move Resend verify runner (scripts/aws/resend-domain-verify.py): the real script
// against a local fake of the Resend API and a fake `aws` CLI. The keys here are made-up test values.
const run = promisify(execFile)
const read = (p) => readFileSync(new URL(p, import.meta.url), 'utf8')
const SCRIPT = new URL('./resend-domain-verify.py', import.meta.url).pathname
const API_KEY = 're_test_admin_' + randomBytes(8).toString('hex')
const SENDING_KEY = 're_test_sending_' + randomBytes(8).toString('hex')

function fakeResend({ netStatus = 'pending', afterVerify = ['pending', 'verified'], hasNet = true } = {}) {
  const state = { requests: [], polls: 0, net: { id: 'dom-net', name: 'mail.seanshore.net', status: netStatus } }
  const records = (status) => [
    { record: 'DKIM', name: 'resend._domainkey.mail', type: 'TXT', status, value: 'p=SECRETLIKEVALUE' },
    { record: 'SPF', name: 'send.mail', type: 'MX', status, value: 'feedback-smtp.example' },
  ]
  const server = http.createServer((req, res) => {
    req.resume()
    req.on('end', () => {
      const send = (status, payload) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload)) }
      const url = new URL(req.url, 'http://127.0.0.1')
      state.requests.push({ method: req.method, path: url.pathname })
      if (req.headers.authorization !== `Bearer ${API_KEY}`) return send(401, { message: 'bad key' })
      if (req.method === 'GET' && url.pathname === '/domains') {
        return send(200, { object: 'list', has_more: false, data: [{ id: 'dom-in', name: 'mail.seanshore.in', status: 'verified' }, ...(hasNet ? [{ id: 'dom-net', name: 'mail.seanshore.net', status: state.net.status }] : [])] })
      }
      if (req.method === 'GET' && url.pathname === '/domains/dom-net') {
        if (state.verifyRequested) state.net.status = afterVerify[Math.min(state.polls++, afterVerify.length - 1)]
        return send(200, { ...state.net, records: records(state.net.status === 'verified' ? 'verified' : 'pending') })
      }
      if (req.method === 'POST' && url.pathname === '/domains/dom-net/verify') { state.verifyRequested = true; return send(200, { object: 'domain', id: 'dom-net' }) }
      send(404, { message: 'not found' })
    })
  })
  return { server, state }
}

function fakeAws(dir, { adminSecret = true } = {}) {
  const log = path.join(dir, 'aws-argv.log')
  writeFileSync(log, '')
  writeFileSync(path.join(dir, 'aws.py'), `
import json, sys
args = sys.argv[1:]
open(${JSON.stringify(log)}, 'a').write(json.dumps(args) + '\\n')
secrets = ${JSON.stringify({ 'sea-n-shore/resend': JSON.stringify({ RESEND_API_KEY: SENDING_KEY }) })}
if ${adminSecret ? 'True' : 'False'}: secrets['sea-n-shore/resend-admin'] = ${JSON.stringify(API_KEY)}
sid = args[args.index('--secret-id') + 1] if '--secret-id' in args else None
if args[:2] == ['secretsmanager', 'get-secret-value']:
    if sid not in secrets: sys.stderr.write('ResourceNotFoundException'); sys.exit(254)
    print(secrets[sid]); sys.exit(0)
sys.stderr.write('unexpected aws call'); sys.exit(2)
`)
  writeFileSync(path.join(dir, 'aws'), `#!/usr/bin/env bash\nexec python3 ${JSON.stringify(path.join(dir, 'aws.py'))} "$@"\n`)
  chmodSync(path.join(dir, 'aws'), 0o755)
  return { argv: () => readFileSync(log, 'utf8') }
}

async function runWith(action, resendOptions = {}, awsOptions = {}) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'resend-domain-'))
  const world = fakeResend(resendOptions)
  await new Promise((resolve) => world.server.listen(0, '127.0.0.1', resolve))
  const aws = fakeAws(dir, awsOptions)
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, RESEND_DOMAIN_VERIFY_TEST_RESEND_API: `http://127.0.0.1:${world.server.address().port}` }
  let result
  try {
    const { stdout, stderr } = await run('python3', ['-I', SCRIPT, action], { env })
    result = { code: 0, stdout, stderr }
  } catch (error) {
    result = { code: error.code, stdout: error.stdout, stderr: error.stderr }
  } finally {
    world.server.close()
  }
  return { ...result, requests: world.state.requests, awsArgv: aws.argv() }
}

const posts = (requests) => requests.filter((r) => r.method === 'POST')

test('the guard reads plan or verify-once with the exact SHA it arms', () => {
  const action = guardAction(read('./resend-domain-verify-action.txt'))
  assert.ok(['plan', 'verify-once'].includes(action), `Unexpected Resend domain verify action: ${action}`)
})

test('plan: reports mail.seanshore.net at Resend and changes nothing', async () => {
  const r = await runWith('plan')
  assert.equal(r.code, 0, r.stderr)
  assert.match(r.stdout, /^RESEND_DOMAIN_VERIFY_ADMIN_SECRET_READABLE=true$/m)
  assert.match(r.stdout, /^RESEND_DOMAIN_VERIFY_DOMAIN_FOUND=true$/m)
  assert.match(r.stdout, /^RESEND_DOMAIN_VERIFY_STATUS=pending records=2 pending=2$/m)
  assert.match(r.stdout, /^RESEND_DOMAIN_VERIFY_RECORD kind=DKIM type=TXT status=pending$/m)
  assert.match(r.stdout, /^RESEND_DOMAIN_VERIFY_PLAN_ONLY_NO_APPLY$/m)
  assert.deepEqual(posts(r.requests), [])
  const missing = await runWith('plan', { hasNet: false })
  assert.equal(missing.code, 0, missing.stderr)
  assert.match(missing.stdout, /^RESEND_DOMAIN_VERIFY_DOMAIN_FOUND=false$/m)
  assert.match(missing.stdout, /^RESEND_DOMAIN_VERIFY_PLAN_ONLY_NO_APPLY$/m)
})

test('verify-once: asks Resend to verify mail.seanshore.net only, then waits for verified', async () => {
  const r = await runWith('verify-once')
  assert.equal(r.code, 0, r.stderr)
  assert.deepEqual(posts(r.requests), [{ method: 'POST', path: '/domains/dom-net/verify' }])
  assert.match(r.stdout, /^RESEND_DOMAIN_VERIFY_VERIFY_REQUESTED=true$/m)
  assert.match(r.stdout, /^RESEND_DOMAIN_VERIFY_STATUS=verified records=2 verified=2$/m)
  assert.match(r.stdout, /^RESEND_DOMAIN_VERIFY_APPLY_VERIFIED=true$/m)
  // mail.seanshore.in is listed by Resend but never read or changed.
  assert.ok(!r.requests.some((q) => q.path.includes('dom-in')))
  // Already verified: no request to verify again.
  const done = await runWith('verify-once', { netStatus: 'verified' })
  assert.equal(done.code, 0, done.stderr)
  assert.deepEqual(posts(done.requests), [])
  assert.match(done.stdout, /^RESEND_DOMAIN_VERIFY_APPLY_VERIFIED=true$/m)
})

test('verify-once refuses: no domain (never creates one), a failed check, a missing admin key', async () => {
  const missing = await runWith('verify-once', { hasNet: false })
  assert.notEqual(missing.code, 0)
  assert.deepEqual(posts(missing.requests), [])
  assert.doesNotMatch(missing.stdout, /APPLY_VERIFIED/)
  const failed = await runWith('verify-once', { afterVerify: ['failed'] })
  assert.notEqual(failed.code, 0)
  assert.doesNotMatch(failed.stdout, /APPLY_VERIFIED/)
  const noKey = await runWith('verify-once', {}, { adminSecret: false })
  assert.notEqual(noKey.code, 0)
  assert.match(noKey.stdout, /^RESEND_DOMAIN_VERIFY_ADMIN_SECRET_READABLE=false$/m)
  assert.deepEqual(noKey.requests, [], 'nothing reaches Resend without the admin key')
})

test('no key, record name or value is ever printed; only the admin key is read', async () => {
  for (const r of [await runWith('plan'), await runWith('verify-once')]) {
    for (const secret of [API_KEY, SENDING_KEY, 'SECRETLIKEVALUE', 'feedback-smtp.example', 'resend._domainkey']) {
      assert.ok(!r.stdout.includes(secret) && !r.stderr.includes(secret), secret)
    }
    const reads = r.awsArgv.trim().split('\n').map((line) => JSON.parse(line))
    assert.deepEqual(reads.map((a) => a[a.indexOf('--secret-id') + 1]), ['sea-n-shore/resend-admin'])
  }
})

test('the runner and workflow: exact commit, account, branch head before verify, owner-merged arm', () => {
  const sh = read('./resend-domain-verify.sh')
  const py = read('./resend-domain-verify.py')
  const workflow = read('../../.github/workflows/aws-resend-domain-verify.yml')
  assert.match(sh, /\[\[ "\$\(git rev-parse HEAD\)" == "\$RESEND_DOMAIN_VERIFY_EXPECTED_SHA" \]\]/)
  assert.match(sh, /\[\[ "\$\(aws sts get-caller-identity --query Account --output text\)" == "\$EXPECTED_ACCOUNT" \]\]/)
  assert.match(sh, /verify-once\)\n\s+\[\[ "\$\(bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1 \| cut -f1\)" == "\$RESEND_DOMAIN_VERIFY_EXPECTED_SHA" \]\]/)
  assert.match(sh, /python3 -I scripts\/aws\/resend-domain-verify\.py "\$ACTION"/)
  assert.match(py, /^DOMAIN = "mail\.seanshore\.net"$/m)
  assert.doesNotMatch(py, /"(PATCH|DELETE)"|resend\("POST", "\/domains"/)
  assert.match(workflow, /^name: AWS Resend Domain Verify$/m)
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/resend-domain-verify-action\.txt/)
  assert.match(workflow, /run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /plan\|discover\) echo "approval=false"/)
  assert.match(workflow, /environment: staging-apply/)
  assert.match(workflow, /export RESEND_DOMAIN_VERIFY_EXPECTED_SHA=\{sha\}\n\s+bash scripts\/aws\/resend-domain-verify\.sh/)
  assert.match(workflow, /if \[\[ "\$ACTION" == verify-once \]\]; then\n\s+grep -qx 'RESEND_DOMAIN_VERIFY_APPLY_VERIFIED=true'/)
  assert.doesNotMatch(workflow, /webhook|delivery/i)
})

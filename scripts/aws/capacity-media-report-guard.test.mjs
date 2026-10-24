import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

// Round P3: the capacity and media report reads production. These checks keep it read-only and aggregate-only.
const actionPath = 'scripts/aws/capacity-media-report-action.txt'
const workflowPath = '.github/workflows/aws-capacity-media-report.yml'
const wrapperPath = 'scripts/aws/capacity-media-report.cjs'
const remotePath = 'scripts/aws/capacity-media-report-remote.py'

const READ_ONLY_ACTION = /^(describe|get|list)-[a-z-]+$/
const DATA_API_READ = new Set(['begin-transaction', 'execute-statement', 'rollback-transaction'])

test('the report is staging-only, exact-head and armed by an owner-merged guard', () => {
  for (const path of [actionPath, workflowPath, wrapperPath, remotePath]) assert.equal(existsSync(path), true, `${path} must exist`)
  const action = guardAction(readFileSync(actionPath, 'utf8'))
  assert.ok(['plan', 'report-once'].includes(action), `Unexpected capacity report action: ${action}`)
  const workflow = readFileSync(workflowPath, 'utf8')
  assert.match(workflow, /feat\/aws-native-phase-0-1/)
  assert.match(workflow, /bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /environment:\s*staging\n/)
  assert.match(workflow, /environment:\s*staging-apply\n/)
  assert.match(workflow, /Guard against a moved branch/)
  assert.match(workflow, /310356785722/)
  assert.match(workflow, /node --test scripts\/aws\/capacity-media-report-guard\.test\.mjs/)
  assert.match(workflow, /plan\|discover\) echo "approval=false"/)
  assert.match(workflow, /report-once\)\n\s+\[\[ "\$GITHUB_EVENT_NAME" == push \]\]/)
})

test('the SSM wrapper only sends the report and reads its result', () => {
  const wrapper = readFileSync(wrapperPath, 'utf8')
  const calls = [...wrapper.matchAll(/'(ssm|ecs|rds|s3|s3api|ec2|lambda|iam)', '([a-z-]+)'/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual([...new Set(calls)].sort(), ['ssm get-command-invocation', 'ssm send-command'])
  assert.match(wrapper, /capacity-media-report-remote\.py/)
  assert.match(wrapper, /\['config', 'usage', 'media'\]/)
})

test('every AWS call in the remote script describes, gets or lists (or reads through the Data API)', () => {
  const remote = readFileSync(remotePath, 'utf8')
  const calls = [...remote.matchAll(/aws\("([a-z0-9-]+)", "([a-z-]+)"/g)].map((m) => [m[1], m[2]])
  assert.ok(calls.length > 30, 'the report makes its AWS calls through aws()')
  for (const [service, action] of calls) {
    const allowed = READ_ONLY_ACTION.test(action) || (service === 'rds-data' && DATA_API_READ.has(action))
    assert.ok(allowed, `${service} ${action} is not a read-only call`)
  }
  assert.doesNotMatch(remote, /commit-transaction/)
  assert.equal((remote.match(/subprocess\.run\(/g) ?? []).length, 2, 'only aws() and the ALB log download run commands')
  // The only other AWS CLI use downloads ALB access logs to a temporary directory.
  const raw = [...remote.matchAll(/\["aws", "([a-z0-9]+)", "([a-z-]+)"/g)].map((m) => `${m[1]} ${m[2]}`)
  assert.deepEqual([...new Set(raw)], ['s3 cp'])
  assert.match(remote, /\["aws", "s3", "cp", "s3:\/\/%s\/%s" % \(bucket, prefix\), tmp, "--recursive"/)
})

test('SQL runs read-only and is rolled back; output carries shapes and counts, not member data', () => {
  const remote = readFileSync(remotePath, 'utf8')
  assert.match(remote, /SET TRANSACTION READ ONLY/)
  assert.match(remote, /assert re\.match\(r"\^\\s\*\(select\|show\|with\)\\b", statement, re\.I\)/)
  assert.match(remote, /finally:\n\s+aws\("rds-data", "rollback-transaction"/)
  // Object keys and request paths are only printed through the shape functions.
  assert.doesNotMatch(remote, /out\([^)]*obj\["Key"\]/)
  assert.match(remote, /route_shape\(path\)/)
  assert.match(remote, /shape_key\(obj\["Key"\]\)/)
  // No column that holds personal data is selected.
  assert.doesNotMatch(remote, /select[^"]*\b(email|full_name|phone|slug|username|ip_hash|approx_city)\b/i)
})

test('the remote script compiles and its shapes never print member data', () => {
  const compiled = spawnSync('python3', ['-I', '-c', `
import importlib.util
spec = importlib.util.spec_from_file_location("r", "${remotePath}")
r = importlib.util.module_from_spec(spec)
spec.loader.exec_module(r)
assert r.route_shape("/in/asha-singh") == "/:x/:x"
assert r.route_shape("/ashasingh") == "/:x"
assert r.route_shape("/jobs/3f2a1c9e-1111-4111-8111-111111111111") == "/jobs/:x"
assert r.route_shape("/api/media/image/profiles/x/y.webp") == "/api/media/image"
k = r.shape_key("private/verification/u1/passport scan Asha Rao.pdf")
assert "asha" not in k.lower() and "rao" not in k.lower() and "passport" not in k.lower(), k
k = r.shape_key("organizations/acme-shipping/logo-1729000000000.png")
assert "acme" not in k, k
print("ok")
`], { encoding: 'utf8' })
  assert.equal(compiled.status, 0, compiled.stderr)
  assert.match(compiled.stdout, /ok/)
})

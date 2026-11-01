// CloudWatch Logs IAM scan contract: AWS's validator vendored unmodified, a read-only plan, and a fix that only adds
// the standard log group ARN to the host role's own policies, behind an owner-merged arm.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { guardAction } from './guard-value.mjs'

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8')
const script = read('./cwl-iam-scan.py')
const runner = read('./cwl-iam-scan.sh')
const workflow = read('../../.github/workflows/aws-cwl-iam-scan.yml')
const VALIDATOR_SHA256 = '63f689699109efd0e3a5f0ec21f06d5700669a9d67051b4b3556721bef9084aa'

test('the guard reads plan or fix-once', () => {
  assert.ok(['plan', 'fix-once'].includes(guardAction(read('./cwl-iam-scan-action.txt'))))
})

test('AWS\'s validator is vendored unmodified, with its licence, and pinned in the host runner too', () => {
  const body = readFileSync(new URL('./cwl-iam/simulate_cloudwatch_logs_policy.py', import.meta.url))
  assert.equal(createHash('sha256').update(body).digest('hex'), VALIDATOR_SHA256)
  assert.match(read('./cwl-iam/LICENSE-MIT-0'), /^MIT No Attribution/)
  assert.ok(runner.includes(VALIDATOR_SHA256))
})

test('the scan logic passes its self-test', () => {
  assert.match(execFileSync('python3', ['-I', 'scripts/aws/cwl-iam-scan.py', '--self-test'], { encoding: 'utf8' }), /CWL_IAM_SELF_TEST=ok/)
})

test('plan only reads; fix-once only writes the host role\'s own policies, and never deletes', () => {
  const calls = [...script.matchAll(/aws\("(\w+)", "([a-z-]+)"/g)].map((m) => `${m[1]} ${m[2]}`)
  const writes = calls.filter((c) => !/ (get|list|simulate)-/.test(c) && c !== 'sts get-caller-identity')
  assert.deepEqual([...new Set(writes)].sort(), ['iam create-policy-version', 'iam put-role-policy'])
  assert.doesNotMatch(script, /delete-|detach-|attach-|create-role|update-assume-role/)
  // Both writes happen only in write_policy, which only the fix-once path calls, after the plan returned.
  const main = script.slice(script.indexOf('def main():'))
  assert.ok(main.indexOf('if action == "plan":\n        return 0') < main.indexOf('write_policy('))
  assert.equal((script.match(/write_policy\(/g) ?? []).length, 2, 'defined once, called once')
  assert.match(script, /--role-name", role/)
  assert.match(script, /already has 5 versions; delete an old one first \(not done automatically\)/)
  // The fix is checked with the validator before it is written and again after.
  assert.match(main, /if breaks_of\(fixed\):\n\s+raise RuntimeError/)
  assert.match(main, /for policy in host_policies\(role\):\n\s+if breaks_of\(policy\["document"\]\):/)
})

test('the host runner refuses a changed checkout, another account or a moved branch', () => {
  assert.match(runner, /git diff --quiet HEAD -- "\$\{FILES\[@\]\}"/)
  assert.match(runner, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(runner, /case "\$ACTION" in plan\|fix-once\) ;;/)
  assert.match(runner, /bash scripts\/aws\/branch-head\.sh refs\/heads\/feat\/aws-native-phase-0-1/)
  assert.match(runner, /echo "CWL_IAM_PLAN_ONLY_NO_CHANGE"/)
})

test('the workflow: owner-merged arm, approval for fix-once, evidence per path', () => {
  assert.match(workflow, /GUARD_FILE: scripts\/aws\/cwl-iam-scan-action\.txt\n\s+shell: bash\n\s+run: bash scripts\/aws\/arm-commit-guard\.sh/)
  assert.match(workflow, /environment: staging-apply/)
  assert.match(workflow, /EVIDENCE='\^CWL_IAM_PLAN_ONLY_NO_CHANGE\$'/)
  assert.match(workflow, /EVIDENCE='\^CWL_IAM_FIX_VERIFIED=true\$'/)
  assert.match(workflow, /bash scripts\/aws\/cwl-iam-scan\.sh/)
})

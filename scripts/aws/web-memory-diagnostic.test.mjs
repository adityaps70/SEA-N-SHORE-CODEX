// Round 13: the web memory diagnostic must stay read-only and never surface secrets.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const script = await readFile(new URL('./web-memory-diagnostic.sh', import.meta.url), 'utf8')
const workflow = await readFile(new URL('../../.github/workflows/aws-web-memory-diagnostic.yml', import.meta.url), 'utf8')

test('web memory diagnostic only reads AWS state', () => {
  const awsCalls = [...script.matchAll(/\baws\s+([a-z0-9-]+)\s+([a-z0-9-]+)/g)].map((match) => `${match[1]} ${match[2]}`)
  assert.ok(awsCalls.length >= 10)
  for (const call of awsCalls) {
    assert.match(call, /^(sts get-caller-identity|ecs (describe|list)-[a-z-]+|application-autoscaling describe-[a-z-]+|elbv2 describe-[a-z-]+|cloudwatch get-metric-data|logs filter-log-events)$/, call)
  }
  assert.doesNotMatch(script, /terraform|update-service|register-task-definition|put-|delete-|create-|apply/)
})

test('web memory diagnostic never prints container environment or secrets', () => {
  assert.doesNotMatch(script, /\.environment\b|\.secrets\b|SecretString|get-secret-value/)
  assert.match(script, /WEB_MEMORY_DIAGNOSTIC_EXPECTED_SHA/)
  assert.match(script, /EXPECTED_ACCOUNT="310356785722"/)
  assert.match(script, /HOUR_BOUNDARY_JUMPS/)
  assert.match(script, /MINUTE_OF_HOUR_MEM_AVG/)
  assert.match(script, /SCALABLE_TARGET_MIN=/)
  assert.match(script, /WEB_MEMORY_DIAGNOSTIC_VERIFIED=true/)
  // filter-log-events prints one count per result page; the counts must be summed.
  assert.match(script, /--query 'length\(events\)' --output text 2>\/dev\/null \\\n\s+\| awk '\{s \+= \$1\} END \{print s \+ 0\}'/)
})

test('web memory diagnostic workflow waits for CI and runs the pinned commit read-only', () => {
  assert.match(workflow, /name: AWS Web Memory Diagnostic/)
  assert.match(workflow, /Wait for exact-head AWS Infrastructure CI/)
  assert.match(workflow, /WEB_MEMORY_DIAGNOSTIC_EXPECTED_SHA=\{sha\}/)
  assert.match(workflow, /bash scripts\/aws\/web-memory-diagnostic\.sh/)
  assert.match(workflow, /grep -q '\^WEB_MEMORY_DIAGNOSTIC_VERIFIED=true\$'/)
  assert.doesNotMatch(workflow, /-action\.txt/)
})

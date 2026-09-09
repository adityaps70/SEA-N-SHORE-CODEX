import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'

const expectedVersion = '3.1095.0'
const awsSdkDependencies = [
  '@aws-sdk/client-eventbridge',
  '@aws-sdk/client-s3',
  '@aws-sdk/client-sqs',
  '@aws-sdk/s3-request-presigner',
]

test('pins direct AWS SDK dependencies to the known coherent release family', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

  for (const dependency of awsSdkDependencies) {
    assert.equal(
      packageJson.dependencies?.[dependency],
      expectedVersion,
      `${dependency} must be pinned exactly to ${expectedVersion} so CI cannot float into an incomplete AWS SDK publish`,
    )
  }
})

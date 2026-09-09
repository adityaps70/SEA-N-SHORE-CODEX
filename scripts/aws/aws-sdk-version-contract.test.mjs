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

test('overrides the unpublished AWS SDK login provider to the published release', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'))

  assert.equal(
    packageJson.overrides?.['@aws-sdk/credential-provider-login'],
    '3.972.77',
    '@aws-sdk/credential-provider-login must resolve to published 3.972.77 while the registry is missing 3.972.78',
  )
})

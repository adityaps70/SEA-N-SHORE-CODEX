import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/aws-remote-verify.yml', 'utf8')

describe('AWS remote runtime verification contract', () => {
  it('excludes known handled product and transient runtime messages from strong-error counting', () => {
    expect(workflow).toContain('Complete your professional profile to discover the network')
    expect(workflow).toContain('Too many Cognito requests. Please try again later')
    expect(workflow).toContain('The destination stream closed early')
  })

  it('does not classify generic error metadata as a standalone runtime fault', () => {
    expect(workflow).toContain("grep -Ev '^\\s*name: [\\\"\\\x27]error[\\\"\\\x27],?\\s*$'")
  })

  it('keeps genuine database, connection, unhandled and HTTP 5xx failures fatal', () => {
    for (const signature of ['unhandled', 'fatal', 'ECONNREFUSED', 'ETIMEDOUT', 'password authentication failed', 'HTTP[[:space:]]+5']) {
      expect(workflow).toContain(signature)
    }
    expect(workflow).toContain('Repeating runtime error signatures detected')
    expect(workflow).toContain('exit 1')
  })
})

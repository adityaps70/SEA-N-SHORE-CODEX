import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync('.github/workflows/aws-remote-verify.yml', 'utf8')

describe('AWS remote runtime verification contract', () => {
  it('excludes known handled product and transient runtime messages from strong-error counting', () => {
    expect(workflow).toContain('Complete your professional profile to discover the network')
    expect(workflow).toContain('Too many Cognito requests. Please try again later')
    expect(workflow).toContain('The destination stream closed early')
  })

  it('excludes the exact admin access denial without weakening generic auth failure detection', () => {
    expect(workflow).toContain("EXPECTED_ADMIN_FORBIDDEN_PATTERN='^⨯ Error: admin_forbidden$'")
    expect(workflow).toContain('IGNORED_EXPECTED_ADMIN_FORBIDDEN_REQUESTS')
    expect(workflow).toContain('grep -Ev "$EXPECTED_ADMIN_FORBIDDEN_PATTERN"')
    expect(workflow).toContain('auth[^[:cntrl:]]*(failed|error)')
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

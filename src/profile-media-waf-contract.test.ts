import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('profile media WAF contract', () => {
  it('does not block legitimate profile image Server Action bodies with the managed body-size rule', () => {
    const edge = readFileSync('infra/aws/app/edge.tf', 'utf8')
    expect(edge).toContain('rule_action_override')
    expect(edge).toContain('SizeRestrictions_BODY')
    expect(edge).toMatch(/SizeRestrictions_BODY[\s\S]*?count\s*\{\}/)
  })
})

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('profile media WAF contract', () => {
  it('counts managed body-size and body-XSS matches so legitimate multipart profile images can reach bounded follow-up rules', () => {
    const edge = readFileSync('infra/aws/app/edge.tf', 'utf8')
    expect(edge).toContain('rule_action_override')
    expect(edge).toMatch(/SizeRestrictions_BODY[\s\S]*?count\s*\{\}/)
    expect(edge).toMatch(/CrossSiteScripting_BODY[\s\S]*?count\s*\{\}/)
  })

  it('re-blocks the managed body-XSS label everywhere except exact POST requests to /profile', () => {
    const edge = readFileSync('infra/aws/app/edge.tf', 'utf8')

    expect(edge).toContain('BlockManagedBodyXssExceptProfileMedia')
    expect(edge).toContain('awswaf:managed:aws:core-rule-set:CrossSiteScripting_Body')
    expect(edge).toMatch(/field_to_match\s*\{\s*method\s*\{\s*\}\s*\}[\s\S]*?positional_constraint\s*=\s*"EXACTLY"[\s\S]*?search_string\s*=\s*"POST"/)
    expect(edge).toMatch(/field_to_match\s*\{\s*uri_path\s*\{\s*\}\s*\}[\s\S]*?positional_constraint\s*=\s*"EXACTLY"[\s\S]*?search_string\s*=\s*"\/profile"/)
    expect(edge).toMatch(/BlockManagedBodyXssExceptProfileMedia[\s\S]*?not_statement[\s\S]*?method[\s\S]*?POST[\s\S]*?uri_path[\s\S]*?\/profile/)
  })

  it('keeps the per-IP rate limit enabled after the profile-media exception', () => {
    const edge = readFileSync('infra/aws/app/edge.tf', 'utf8')
    expect(edge).toMatch(/name\s*=\s*"PerIpRateLimit"[\s\S]*?priority\s*=\s*20[\s\S]*?rate_based_statement[\s\S]*?limit\s*=\s*2000/)
  })

  it('requires the edge apply workflow to verify the exact live XSS exception before reporting success', () => {
    const recovery = readFileSync('scripts/aws/edge-recovery.sh', 'utf8')

    expect(recovery).toContain('CrossSiteScripting_BODY')
    expect(recovery).toContain('BlockManagedBodyXssExceptProfileMedia')
    expect(recovery).toContain('awswaf:managed:aws:core-rule-set:CrossSiteScripting_Body')
    expect(recovery).toContain('PROFILE_MEDIA_XSS_EXCEPTION_VERIFIED')
  })
})

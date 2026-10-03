import { describe, expect, it } from 'vitest'
import { getServerActionAllowedOrigins } from './server-action-origins'

describe('getServerActionAllowedOrigins', () => {
  it('allows the configured site host plus exact edge hosts for Next.js Server Actions', () => {
    expect(
      getServerActionAllowedOrigins(
        'http://sea-n-shore-staging-alb-68367905.ap-south-1.elb.amazonaws.com',
        'https://d3prih0q6jofyr.cloudfront.net',
      ),
    ).toEqual([
      'sea-n-shore-staging-alb-68367905.ap-south-1.elb.amazonaws.com',
      'd3prih0q6jofyr.cloudfront.net',
    ])
  })

  it('preserves an explicit port and de-duplicates repeated exact hosts', () => {
    expect(
      getServerActionAllowedOrigins(
        'http://localhost:3000',
        'http://localhost:3000, https://staging.example.com',
      ),
    ).toEqual(['localhost:3000', 'staging.example.com'])
  })

  it('does not create wildcard, non-http, or malformed allowlist entries', () => {
    expect(getServerActionAllowedOrigins(undefined, undefined)).toEqual([])
    expect(getServerActionAllowedOrigins('not-a-url', '*, ftp://example.com, also-bad')).toEqual([])
  })
})

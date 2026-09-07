import { describe, expect, it } from 'vitest'
import { getServerActionAllowedOrigins } from './server-action-origins'

describe('getServerActionAllowedOrigins', () => {
  it('allows only the configured site host for Next.js Server Actions', () => {
    expect(getServerActionAllowedOrigins('https://d3prih0q6jofyr.cloudfront.net')).toEqual([
      'd3prih0q6jofyr.cloudfront.net',
    ])
  })

  it('preserves an explicit port for local or non-default staging origins', () => {
    expect(getServerActionAllowedOrigins('http://localhost:3000')).toEqual(['localhost:3000'])
  })

  it('does not create a wildcard or malformed allowlist entry', () => {
    expect(getServerActionAllowedOrigins(undefined)).toEqual([])
    expect(getServerActionAllowedOrigins('not-a-url')).toEqual([])
    expect(getServerActionAllowedOrigins('ftp://example.com')).toEqual([])
  })
})

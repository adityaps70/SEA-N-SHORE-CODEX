import { describe, expect, it } from 'vitest'
import nextConfig from '../next.config'

describe('feed PDF framing security', () => {
  it('keeps clickjacking protection globally but permits same-origin feed document framing', async () => {
    const rules = await nextConfig.headers?.()

    const globalRule = rules?.find((rule) => rule.source === '/(.*)')
    const feedMediaRule = rules?.find((rule) => rule.source === '/api/feed-media/:path*')

    expect(globalRule?.headers).toContainEqual({
      key: 'X-Frame-Options',
      value: 'DENY',
    })
    expect(feedMediaRule?.headers).toContainEqual({
      key: 'X-Frame-Options',
      value: 'SAMEORIGIN',
    })
  })
})

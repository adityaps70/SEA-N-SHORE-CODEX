import { describe, expect, it } from 'vitest'
import nextConfig from '../next.config'

describe('Next.js redirects', () => {
  it('sends /learn/my to My Learning with a 301 (round E)', async () => {
    await expect(nextConfig.redirects?.()).resolves.toEqual([
      { source: '/learn/my', destination: '/learn/my-learning', statusCode: 301 },
    ])
  })
})

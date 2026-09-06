import { describe, expect, it } from 'vitest'
import nextConfig from '../next.config'

describe('Next.js server action upload envelope', () => {
  it('allows the 5 MiB composer image limit plus multipart form overhead', () => {
    const serverActions = nextConfig.experimental?.serverActions

    expect(serverActions).toMatchObject({
      bodySizeLimit: '6mb',
    })
  })
})

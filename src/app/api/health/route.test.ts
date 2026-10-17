import { describe, expect, it } from 'vitest'
import { GET, HEAD } from './route'

describe('GET /api/health', () => {
  it('answers 200 JSON without caching', async () => {
    const response = GET()
    expect(response.status).toBe(200)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toEqual({ status: 'ok' })
    expect(HEAD().status).toBe(200)
  })
})

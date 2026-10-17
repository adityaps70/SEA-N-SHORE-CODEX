import { describe, expect, it } from 'vitest'
import * as route from './route'

describe('/api/* without a route (Round H, H2)', () => {
  it('answers 404 JSON for every method', async () => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const) {
      const response = route[method]()
      expect(response.status, method).toBe(404)
      expect(response.headers.get('content-type'), method).toContain('application/json')
      expect(response.headers.get('cache-control'), method).toBe('private, no-store')
    }
    expect(await route.GET().json()).toEqual({ error: 'Not found.' })
  })
})

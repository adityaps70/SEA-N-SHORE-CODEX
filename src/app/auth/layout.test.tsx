import { describe, expect, it } from 'vitest'
import { dynamic, revalidate } from './layout'

describe('auth route cache policy', () => {
  it('renders auth pages from the current deployment instead of shared prerender cache', () => {
    expect(dynamic).toBe('force-dynamic')
    expect(revalidate).toBe(0)
  })
})

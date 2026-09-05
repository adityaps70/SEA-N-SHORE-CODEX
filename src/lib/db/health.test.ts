import { describe, expect, it, vi } from 'vitest'
import { createPhase4DatabaseHealthCheck } from './health'

describe('Phase 4 database health', () => {
  it('reports healthy only when Aurora responds and the migrated identity set is present', async () => {
    const query = vi.fn(async () => [{ database_ok: 1, identity_mappings_ok: true }])
    const check = createPhase4DatabaseHealthCheck({ query })

    await expect(check()).resolves.toEqual({ database: true, identityMappings: true })
    expect(query).toHaveBeenCalledWith(expect.stringContaining('public.identity_accounts'), ['cognito'])
  })

  it('reports an identity migration problem without exposing row data', async () => {
    const check = createPhase4DatabaseHealthCheck({
      query: vi.fn(async () => [{ database_ok: 1, identity_mappings_ok: false }]),
    })

    await expect(check()).resolves.toEqual({ database: true, identityMappings: false })
  })
})

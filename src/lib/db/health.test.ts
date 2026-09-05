import { describe, expect, it, vi } from 'vitest'
import { classifyDatabaseFailure, createPhase4DatabaseHealthCheck } from './health'

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

  it.each([
    [{ code: 'ENOTFOUND' }, 'dns'],
    [{ code: 'EAI_AGAIN' }, 'dns'],
    [{ code: 'ETIMEDOUT' }, 'timeout'],
    [{ code: 'ECONNREFUSED' }, 'network'],
    [{ code: 'ECONNRESET' }, 'network'],
    [{ code: 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' }, 'tls'],
    [{ code: 'SELF_SIGNED_CERT_IN_CHAIN' }, 'tls'],
    [{ code: '28P01' }, 'authentication'],
    [{ code: '3D000' }, 'database'],
    [{ code: '42P01' }, 'schema'],
    [{ name: 'ZodError' }, 'configuration'],
    [{ code: 'SOMETHING_ELSE' }, 'unknown'],
  ] as const)('classifies database failures without returning raw error detail', (error, expected) => {
    expect(classifyDatabaseFailure(error)).toBe(expected)
  })
})

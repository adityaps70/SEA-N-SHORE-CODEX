import { describe, expect, it, vi } from 'vitest'
import { classifyDatabaseFailure, createPhase4DatabaseHealthCheck } from './health'

describe('Phase 4 database health', () => {
  it('reports healthy only when Aurora, identity mappings, and the Home content/network schema are present', async () => {
    const query = vi.fn(async () => [{
      database_ok: 1,
      identity_mappings_ok: true,
      content_network_ok: true,
    }])
    const check = createPhase4DatabaseHealthCheck({ query })

    await expect(check()).resolves.toEqual({
      database: true,
      identityMappings: true,
      contentNetwork: true,
    })
    const sql = query.mock.calls[0]?.[0] ?? ''
    expect(sql).toContain('public.identity_accounts')
    for (const table of [
      'public.posts',
      'public.post_reactions',
      'public.post_comments',
      'public.saved_posts',
      'public.post_media',
      'public.post_polls',
      'public.post_poll_options',
      'public.post_poll_votes',
      'public.follows',
      'public.connections',
      'public.user_blocks',
    ]) {
      expect(sql).toContain(table)
    }
    expect(query).toHaveBeenCalledWith(expect.any(String), ['cognito'])
  })

  it('reports an identity migration problem without exposing row data', async () => {
    const check = createPhase4DatabaseHealthCheck({
      query: vi.fn(async () => [{
        database_ok: 1,
        identity_mappings_ok: false,
        content_network_ok: true,
      }]),
    })

    await expect(check()).resolves.toEqual({
      database: true,
      identityMappings: false,
      contentNetwork: true,
    })
  })

  it('reports a missing Home schema without exposing table contents or user data', async () => {
    const check = createPhase4DatabaseHealthCheck({
      query: vi.fn(async () => [{
        database_ok: 1,
        identity_mappings_ok: true,
        content_network_ok: false,
      }]),
    })

    await expect(check()).resolves.toEqual({
      database: true,
      identityMappings: true,
      contentNetwork: false,
    })
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

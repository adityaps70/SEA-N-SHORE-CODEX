import { describe, expect, it, vi } from 'vitest'
import { sealRecovery, sealRenewal, unsealRecovery, unsealRenewal } from './refresh-renewals'
import { createRefreshTokenLedger, refreshTokenHash } from './refresh-token-ledger'

// Round ARCH: when Cognito refuses a refresh token as reused, our record of that sign-in ends too.
describe('refresh token ledger: endSession', () => {
  it('ends the sign-in the token belongs to, found by the token hash, and says so without member data', async () => {
    const query = vi.fn(async () => [{ id: 'session-1' }])
    const warn = vi.fn()
    const ledger = createRefreshTokenLedger({ query: query as never, warn })
    await ledger.endSession!('reused-refresh-token')
    const [sql, params] = query.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toMatch(/update public\.auth_sessions\s+set reuse_detected_at = now\(\)/)
    expect(sql).toMatch(/from public\.auth_refresh_tokens where token_hash = \$1/)
    expect(params).toEqual([refreshTokenHash('reused-refresh-token')])
    expect(JSON.stringify(params)).not.toContain('reused-refresh-token')
    expect(warn).toHaveBeenCalledWith('[auth_refresh_reuse]', { action: 'session_ended', source: 'cognito' })
  })

  it('stays quiet when no sign-in matched, and never throws on a database error', async () => {
    const warn = vi.fn()
    await createRefreshTokenLedger({ query: vi.fn(async () => []) as never, warn }).endSession!('unknown-token')
    expect(warn).not.toHaveBeenCalled()
    const failing = createRefreshTokenLedger({ query: vi.fn(async () => { throw new Error('db down') }) as never, warn })
    await expect(failing.endSession!('reused-refresh-token')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('[auth_refresh_ledger_unavailable]', { stage: 'end_session' })
  })
})

// Owner (19 Nov): check only reports reuse; ending is endReused, after a recovery was tried.
describe('refresh token ledger: check, recover and endReused', () => {
  const KEY = Buffer.alloc(32, 7)
  const token = (jti: string) => `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ origin_jti: 'origin-unit-0001', jti })).toString('base64url')}.signature`

  it('check reads one row and ends nothing; endReused ends the sign-in by the token hash, and says so without member data', async () => {
    const query = vi.fn<(text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>>(async () => [{ origin_hash: 'a'.repeat(64) }])
    const warn = vi.fn()
    const ledger = createRefreshTokenLedger({ query: query as never, warn })
    await expect(ledger.check('old-refresh-token')).resolves.toBe('reused')
    expect(query).toHaveBeenCalledTimes(1)
    expect(query.mock.calls[0]![0]).toMatch(/^select origin_hash/)
    expect(warn).not.toHaveBeenCalled()

    await ledger.endReused('old-refresh-token')
    const [sql, params] = query.mock.calls[1]!
    expect(sql).toMatch(/update public\.auth_sessions\s+set reuse_detected_at = now\(\)/)
    expect(params).toEqual([refreshTokenHash('old-refresh-token')])
    expect(warn).toHaveBeenCalledWith('[auth_refresh_reuse]', { action: 'session_ended' })
  })

  it('recover without a key asks nothing; with one it takes the row in one statement, locked and spent as it is read', async () => {
    const idle = vi.fn(async () => [])
    await expect(createRefreshTokenLedger({ query: idle as never }).recover('old')).resolves.toBeNull()
    expect(idle).not.toHaveBeenCalled()

    const query = vi.fn<(text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>>(async () => [])
    await expect(createRefreshTokenLedger({ query: query as never, recoveryKey: KEY }).recover('old')).resolves.toBeNull()
    expect(query).toHaveBeenCalledTimes(1)
    const [sql, params] = query.mock.calls[0]!
    expect(sql).toMatch(/for update of t/)
    expect(sql).toMatch(/s\.renewal_seen_at is null/)
    expect(sql).toMatch(/set recovered_at = now\(\), recovery_sealed = null/)
    expect(params).toEqual([refreshTokenHash('old')])
  })

  it('a failure to keep a renewal never fails the refresh: logged by stage, silent while 0112 is missing', async () => {
    for (const [code, expected] of [['08006', [['[auth_refresh_ledger_unavailable]', { stage: 'recovery_keep' }]]], ['42703', []]] as const) {
      const warn = vi.fn()
      let calls = 0
      const query = vi.fn(async () => {
        calls += 1
        if (calls === 3) throw Object.assign(new Error('failed'), { code })
        return []
      })
      const ledger = createRefreshTokenLedger({ query: query as never, recoveryKey: KEY, warn })
      await expect(ledger.record({ previousRefreshToken: 'r0', authentication: { accessToken: token('jti-unit-00000001'), refreshToken: 'r1', expiresIn: 3600 } })).resolves.toBeUndefined()
      expect(query).toHaveBeenCalledTimes(3)
      expect(warn.mock.calls).toEqual(expected)
      expect(JSON.stringify(query.mock.calls)).not.toContain('jti-unit-00000001')
    }
  })
})

describe('refresh recovery seal (owner 19 Nov)', () => {
  it('opens only for the old token it was bound to, with its own key, and never as a shared-renewal seal', () => {
    const key = Buffer.alloc(32, 3)
    const set = { accessToken: 'access-2', refreshToken: 'refresh-2', expiresIn: 3600 }
    const sealed = sealRecovery(key, 'a'.repeat(64), set, 1_000)
    expect(sealed).not.toContain('refresh-2')
    expect(unsealRecovery(key, 'a'.repeat(64), sealed, 1_000)).toEqual(set)
    expect(unsealRecovery(key, 'b'.repeat(64), sealed, 1_000)).toBeNull()
    expect(unsealRecovery(Buffer.alloc(32, 4), 'a'.repeat(64), sealed, 1_000)).toBeNull()
    expect(unsealRenewal(key, 'a'.repeat(64), sealed, 1_000)).toBeNull()
    expect(unsealRecovery(key, 'a'.repeat(64), sealRenewal(key, 'a'.repeat(64), set, 1_000), 1_000)).toBeNull()
  })
})


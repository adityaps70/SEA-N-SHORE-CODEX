import { describe, expect, it, vi } from 'vitest'
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

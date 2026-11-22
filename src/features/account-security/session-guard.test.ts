import { describe, expect, it, vi } from 'vitest'
import { accessTokenJtiHash, createSessionGuard, sessionOriginHash, SESSION_CHECK_CACHE_MS } from './session-guard'
import type { SessionState } from './session-repository'

function accessToken(claims: Record<string, unknown>) {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`
}

const PROFILE = '11111111-1111-4111-8111-111111111111'
const context = () => ({ userAgentSummary: 'Safari on iPhone', city: null, country: null, ip: null })

function fakeRepository(state: Partial<SessionState> = {}) {
  const row: SessionState = { id: 'session-1', profileId: PROFILE, revoked: false, reuseDetected: false, lastSeenAt: new Date(0), ...state }
  return {
    row,
    findOrCreate: vi.fn(async () => ({ ...row })),
    touch: vi.fn(async () => undefined),
    markRenewalSeen: vi.fn<(sessionId: string, jtiHash: string) => Promise<void>>(async () => { row.renewalSeen = true }),
  }
}

describe('session guard (Round H, H3)', () => {
  it('keys the session on the access token\'s origin_jti, creating it on first sight (sessions from before this release too)', async () => {
    const repository = fakeRepository()
    const guard = createSessionGuard({ repository, now: () => 1_000_000 })
    const token = accessToken({ origin_jti: 'origin-aaaa-0001', scope: 'openid email' })

    await expect(guard.check({ accessToken: token, profileId: PROFILE, context })).resolves.toEqual({ status: 'active', sessionId: 'session-1' })
    expect(repository.findOrCreate).toHaveBeenCalledWith(expect.objectContaining({
      profileId: PROFILE,
      originHash: sessionOriginHash('origin-aaaa-0001'),
      signInMethod: 'google',
      userAgentSummary: 'Safari on iPhone',
      ipHash: null,
    }))
  })

  it('checks the database at most every 30 seconds per sign-in, and moves last seen at most every 5 minutes', async () => {
    let now = 10 * 60 * 1000
    const repository = fakeRepository({ lastSeenAt: new Date(now - 60 * 1000) })
    const guard = createSessionGuard({ repository, now: () => now })
    const token = accessToken({ origin_jti: 'origin-aaaa-0002' })

    await guard.check({ accessToken: token, profileId: PROFILE, context })
    await guard.check({ accessToken: token, profileId: PROFILE, context })
    expect(repository.findOrCreate).toHaveBeenCalledTimes(1)
    expect(repository.touch).not.toHaveBeenCalled()

    now += SESSION_CHECK_CACHE_MS + 1
    repository.row.lastSeenAt = new Date(now - 6 * 60 * 1000)
    await guard.check({ accessToken: token, profileId: PROFILE, context })
    expect(repository.findOrCreate).toHaveBeenCalledTimes(2)
    expect(repository.touch).toHaveBeenCalledWith('session-1')
  })

  it('refuses a revoked session, and a revocation made on this server applies at once', async () => {
    const repository = fakeRepository()
    const guard = createSessionGuard({ repository, now: () => 1_000_000 })
    const token = accessToken({ origin_jti: 'origin-aaaa-0003' })
    await expect(guard.check({ accessToken: token, profileId: PROFILE, context })).resolves.toMatchObject({ status: 'active' })

    guard.markRevoked(['session-1'])
    await expect(guard.check({ accessToken: token, profileId: PROFILE, context })).resolves.toEqual({ status: 'revoked', sessionId: 'session-1', reason: 'signed_out' })
    expect(repository.findOrCreate).toHaveBeenCalledTimes(1)

    const revokedRepository = fakeRepository({ revoked: true })
    await expect(createSessionGuard({ repository: revokedRepository, now: () => 1_000_000 }).check({ accessToken: token, profileId: PROFILE, context })).resolves.toMatchObject({ status: 'revoked' })
    expect(revokedRepository.touch).not.toHaveBeenCalled()
  })

  it('owner 18 Nov: a sign-in ended on another server is dropped from this server at once (cache-clear hub)', async () => {
    const repository = fakeRepository()
    let registered: { dropTag(tag: string): void; dropAll(): void } | null = null
    const guard = createSessionGuard({ repository, now: () => 1_000_000, clearHub: { register: (cache) => { registered = cache } } })
    const token = accessToken({ origin_jti: 'origin-aaaa-0004' })
    await expect(guard.check({ accessToken: token, profileId: PROFILE, context })).resolves.toMatchObject({ status: 'active' })
    // Another server revokes it: the database row changes and the clear for its origin hash arrives here.
    repository.row.revoked = true
    registered!.dropTag(`s:${sessionOriginHash('origin-aaaa-0004')}`)
    await expect(guard.check({ accessToken: token, profileId: PROFILE, context })).resolves.toEqual({ status: 'revoked', sessionId: 'session-1', reason: 'signed_out' })
    expect(repository.findOrCreate).toHaveBeenCalledTimes(2)
    // A clear for another sign-in, or a lost listener, never leaves a stale answer: the latter drops everything.
    registered!.dropTag(`s:${sessionOriginHash('origin-other')}`)
    registered!.dropAll()
    await guard.check({ accessToken: token, profileId: PROFILE, context })
    expect(repository.findOrCreate).toHaveBeenCalledTimes(3)
  })

  it('keeps a session used within 30 days and ends one not used for longer (Round I, I3 sliding session)', async () => {
    const DAY = 24 * 60 * 60 * 1000
    const now = 400 * DAY
    const token = accessToken({ origin_jti: 'origin-aaaa-0101' })

    const recent = fakeRepository({ lastSeenAt: new Date(now - 29 * DAY) })
    await expect(createSessionGuard({ repository: recent, now: () => now }).check({ accessToken: token, profileId: PROFILE, context }))
      .resolves.toEqual({ status: 'active', sessionId: 'session-1' })
    // Using it moves last_seen_at on, which is what slides the 30 days.
    expect(recent.touch).toHaveBeenCalledWith('session-1')

    const idle = fakeRepository({ lastSeenAt: new Date(now - 30 * DAY - 60_000) })
    await expect(createSessionGuard({ repository: idle, now: () => now }).check({ accessToken: token, profileId: PROFILE, context }))
      .resolves.toEqual({ status: 'revoked', sessionId: 'session-1', reason: 'idle' })
    expect(idle.touch).not.toHaveBeenCalled()
  })

  it('ends a sign-in whose old refresh token was used again (Round I, I3)', async () => {
    const repository = fakeRepository({ reuseDetected: true })
    const guard = createSessionGuard({ repository, now: () => 1_000_000 })
    await expect(guard.check({ accessToken: accessToken({ origin_jti: 'origin-aaaa-0102' }), profileId: PROFILE, context }))
      .resolves.toEqual({ status: 'revoked', sessionId: 'session-1', reason: 'refresh_reuse' })
    expect(repository.touch).not.toHaveBeenCalled()
  })

  it('never accepts a sign-in that belongs to another profile', async () => {
    const repository = fakeRepository({ profileId: '22222222-2222-4222-8222-222222222222' })
    const guard = createSessionGuard({ repository, now: () => 1_000_000 })
    await expect(guard.check({ accessToken: accessToken({ origin_jti: 'origin-aaaa-0004' }), profileId: PROFILE, context })).resolves.toMatchObject({ status: 'revoked' })
  })

  it('leaves a token without origin_jti untracked, and fails open only while the table does not exist yet', async () => {
    const warn = vi.fn()
    const repository = fakeRepository()
    const guard = createSessionGuard({ repository, warn, now: () => 1_000_000 })
    await expect(guard.check({ accessToken: accessToken({ scope: 'x' }), profileId: PROFILE, context })).resolves.toEqual({ status: 'untracked' })
    expect(repository.findOrCreate).not.toHaveBeenCalled()
    expect(warn).toHaveBeenCalledWith('[auth_session_untracked]', { reason: 'no_origin_jti' })

    repository.findOrCreate.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }))
    await expect(guard.check({ accessToken: accessToken({ origin_jti: 'origin-aaaa-0005' }), profileId: PROFILE, context })).resolves.toEqual({ status: 'untracked' })

    const broken = Object.assign(new Error('permission denied'), { code: '42501' })
    repository.findOrCreate.mockRejectedValueOnce(broken)
    await expect(guard.check({ accessToken: accessToken({ origin_jti: 'origin-aaaa-0006' }), profileId: PROFILE, context })).rejects.toBe(broken)
  })
})

describe('session guard: a renewal is seen on the first request that carries it (owner 19 Nov, refresh recovery)', () => {
  const ORIGIN = 'origin-recovery-0001'
  const token = (jti: string) => accessToken({ origin_jti: ORIGIN, jti })

  it('marks the renewal seen on the first request with its access token, bypassing the 30-second cache for a new token once', async () => {
    let now = 1_000_000
    const repository = fakeRepository({ lastSeenAt: new Date(now) })
    const guard = createSessionGuard({ repository, now: () => now })

    // The old access token fills the cache.
    await guard.check({ accessToken: token('jti-old-00000001'), profileId: PROFILE, context })
    expect(repository.findOrCreate).toHaveBeenCalledTimes(1)

    // A renewal is recorded for a new token; the device's next request carries it, within the 30 seconds.
    repository.row.renewalJtiHash = accessTokenJtiHash(token('jti-new-00000002'))
    repository.row.renewalSeen = false
    now += 5_000
    await guard.check({ accessToken: token('jti-new-00000002'), profileId: PROFILE, context })
    expect(repository.findOrCreate).toHaveBeenCalledTimes(2)
    expect(repository.markRenewalSeen).toHaveBeenCalledTimes(1)
    expect(repository.markRenewalSeen).toHaveBeenCalledWith('session-1', accessTokenJtiHash(token('jti-new-00000002')))

    // Once: the same token is answered from the cache again, and nothing is marked twice.
    now += 5_000
    await guard.check({ accessToken: token('jti-new-00000002'), profileId: PROFILE, context })
    expect(repository.findOrCreate).toHaveBeenCalledTimes(2)
    now += SESSION_CHECK_CACHE_MS + 1
    await guard.check({ accessToken: token('jti-new-00000002'), profileId: PROFILE, context })
    expect(repository.findOrCreate).toHaveBeenCalledTimes(3)
    expect(repository.markRenewalSeen).toHaveBeenCalledTimes(1)
  })

  it('never counts the request in which the proxy made the renewal, and marks only the renewal\'s own token', async () => {
    const now = 2_000_000
    const repository = fakeRepository({ lastSeenAt: new Date(now), renewalJtiHash: accessTokenJtiHash(token('jti-new-00000003')), renewalSeen: false })
    const guard = createSessionGuard({ repository, now: () => now })

    // The renewing request itself: the new token came from the server, not the device.
    await guard.check({ accessToken: token('jti-new-00000003'), profileId: PROFILE, context, renewedInRequest: true })
    expect(repository.markRenewalSeen).not.toHaveBeenCalled()
    // A token other than the renewal's (an older one still in another request) marks nothing.
    await guard.check({ accessToken: token('jti-other-0000004'), profileId: PROFILE, context })
    expect(repository.markRenewalSeen).not.toHaveBeenCalled()
    // The device's own next request with the new token does, at once, though the cache was filled moments ago.
    await guard.check({ accessToken: token('jti-new-00000003'), profileId: PROFILE, context })
    expect(repository.markRenewalSeen).toHaveBeenCalledTimes(1)
  })

  it('marks nothing for a renewal already seen or a sign-in that ended, and never fails a request on the mark', async () => {
    const jtiHash = accessTokenJtiHash(token('jti-new-00000005'))
    const seen = fakeRepository({ renewalJtiHash: jtiHash, renewalSeen: true, lastSeenAt: new Date(1_000_000) })
    await createSessionGuard({ repository: seen, now: () => 1_000_000 }).check({ accessToken: token('jti-new-00000005'), profileId: PROFILE, context })
    expect(seen.markRenewalSeen).not.toHaveBeenCalled()

    const ended = fakeRepository({ renewalJtiHash: jtiHash, renewalSeen: false, reuseDetected: true })
    await expect(createSessionGuard({ repository: ended, now: () => 1_000_000 }).check({ accessToken: token('jti-new-00000005'), profileId: PROFILE, context }))
      .resolves.toMatchObject({ status: 'revoked', reason: 'refresh_reuse' })
    expect(ended.markRenewalSeen).not.toHaveBeenCalled()

    const warn = vi.fn()
    const failing = fakeRepository({ renewalJtiHash: jtiHash, renewalSeen: false, lastSeenAt: new Date(1_000_000) })
    failing.markRenewalSeen.mockRejectedValueOnce(Object.assign(new Error('down'), { code: '08006' }))
    await expect(createSessionGuard({ repository: failing, warn, now: () => 1_000_000 }).check({ accessToken: token('jti-new-00000005'), profileId: PROFILE, context }))
      .resolves.toEqual({ status: 'active', sessionId: 'session-1' })
    expect(warn).toHaveBeenCalledWith('[auth_session_renewal_seen_unavailable]', { stage: 'mark' })
  })
})

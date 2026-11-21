import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { CognitoApiError, type CognitoAuthenticationResult } from '@/lib/auth/cognito-api'
import { COGNITO_COOKIE_NAMES } from '@/lib/auth/cognito-cookies'
import { createCognitoSessionManager } from '@/lib/auth/cognito-session'
import { createRefreshSingleFlight } from '@/lib/auth/refresh-single-flight'
import { deriveAccountSecurityKey } from './keys'
import { createRefreshRenewalStore } from './refresh-renewals'
import { REFRESH_RECOVERY_SECONDS, createRefreshTokenLedger, refreshTokenHash } from './refresh-token-ledger'
import { accessTokenJtiHash, createSessionGuard, sessionOriginHash } from './session-guard'
import { createSessionRepository } from './session-repository'
import type { AccountQuery } from './types'

/**
 * Owner (19 Nov): recovering a renewal the device never received (migration 0112), against the real schema (PGlite
 * with every migration). Placeholder tokens and data only.
 */
let db: TestDatabase
const query: AccountQuery = (text, values) => db.query(text, values) as Promise<Array<Record<string, unknown>>>
const recoveryKey = deriveAccountSecurityKey('placeholder-server-secret-that-is-long-enough-1234', 'refresh-recovery')!
const context = () => ({ userAgentSummary: 'Chrome on Mac', city: null, country: null, ip: null })
const DAY_SECONDS = 24 * 60 * 60

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

let counter = 0
function accessToken(originJti: string, jti: string) {
  const claims = Buffer.from(JSON.stringify({ origin_jti: originJti, jti, scope: 'aws.cognito.signin.user.admin' })).toString('base64url')
  return `eyJhbGciOiJub25lIn0.${claims}.signature`
}

/** A signed-in device: its auth_sessions row exists (created by the session check, as at sign-in). */
async function signedIn() {
  counter += 1
  const origin = `origin-recovery-${String(counter).padStart(4, '0')}`
  const rows = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Member') returning id`)
  const profileId = String(rows[0]!.id)
  const guard = createSessionGuard({ repository: createSessionRepository({ query }) })
  await expect(guard.check({ accessToken: accessToken(origin, `jti-${origin}-0`), profileId, context })).resolves.toMatchObject({ status: 'active' })
  return { origin, profileId, originHash: sessionOriginHash(origin) }
}

function renewal(origin: string, step: number, refreshToken: string): CognitoAuthenticationResult {
  return { accessToken: accessToken(origin, `jti-${origin}-${step}`), refreshToken, expiresIn: 3600 }
}

/** The old token's row as if its renewal happened more than the 60-second grace ago. */
async function pastGrace(refreshToken: string) {
  await db.query(`update public.auth_refresh_tokens set superseded_at = now() - interval '2 hours' where token_hash = $1`, [refreshTokenHash(refreshToken)])
}

describe('refresh recovery in the ledger (auth_refresh_tokens, auth_sessions)', () => {
  it('record keeps the new tokens sealed on the old row for at most 30 days, only for the latest renewal, never in clear', async () => {
    const device = await signedIn()
    const ledger = createRefreshTokenLedger({ query, recoveryKey })
    await ledger.record({ previousRefreshToken: `${device.origin}-r0`, authentication: renewal(device.origin, 1, `${device.origin}-r1`) })

    const [kept] = await db.query(
      `select recovery_sealed, extract(epoch from recovery_expires_at - now())::int as seconds_left, recovered_at
       from public.auth_refresh_tokens where token_hash = $1`,
      [refreshTokenHash(`${device.origin}-r0`)],
    )
    expect(typeof kept!.recovery_sealed).toBe('string')
    expect(String(kept!.recovery_sealed)).not.toContain(`${device.origin}-r1`)
    expect(String(kept!.recovery_sealed)).not.toContain('eyJ')
    expect(Number(kept!.seconds_left)).toBeLessThanOrEqual(30 * DAY_SECONDS)
    expect(Number(kept!.seconds_left)).toBeGreaterThan(30 * DAY_SECONDS - 60)
    expect(REFRESH_RECOVERY_SECONDS).toBe(30 * DAY_SECONDS)
    expect(kept!.recovered_at).toBeNull()
    // The new (current) token keeps nothing.
    const [current] = await db.query(`select recovery_sealed from public.auth_refresh_tokens where token_hash = $1`, [refreshTokenHash(`${device.origin}-r1`)])
    expect(current!.recovery_sealed).toBeNull()
    const [session] = await db.query(`select renewal_jti_hash, renewal_seen_at from public.auth_sessions where token_origin_hash = $1`, [device.originHash])
    expect(session).toEqual({ renewal_jti_hash: accessTokenJtiHash(renewal(device.origin, 1, 'x').accessToken), renewal_seen_at: null })

    // The next renewal moves what is kept to r1's row and clears r0's: only the latest renewal can be recovered.
    await ledger.record({ previousRefreshToken: `${device.origin}-r1`, authentication: renewal(device.origin, 2, `${device.origin}-r2`) })
    const rows = await db.query(
      `select token_hash, recovery_sealed is not null as kept, recovery_expires_at is not null as expires from public.auth_refresh_tokens where origin_hash = $1`,
      [device.originHash],
    )
    const byHash = Object.fromEntries(rows.map((row) => [row.token_hash, { kept: row.kept, expires: row.expires }]))
    expect(byHash[refreshTokenHash(`${device.origin}-r0`)]).toEqual({ kept: false, expires: false })
    expect(byHash[refreshTokenHash(`${device.origin}-r1`)]).toEqual({ kept: true, expires: true })
    expect(byHash[refreshTokenHash(`${device.origin}-r2`)]).toEqual({ kept: false, expires: false })
    await pastGrace(`${device.origin}-r0`)
    await expect(ledger.recover(`${device.origin}-r0`)).resolves.toBeNull()
  })

  it('recover hands the renewal back once and only once, also to two requests at the same moment', async () => {
    const device = await signedIn()
    const ledger = createRefreshTokenLedger({ query, recoveryKey })
    await ledger.record({ previousRefreshToken: `${device.origin}-r0`, authentication: renewal(device.origin, 1, `${device.origin}-r1`) })
    await pastGrace(`${device.origin}-r0`)
    await expect(ledger.check(`${device.origin}-r0`)).resolves.toBe('reused')

    // PGlite runs one statement at a time, so these two run back to back; on Aurora the row lock (for update of t)
    // makes the second wait and then find recovered_at set. Either way exactly one gets the set.
    const [first, second] = await Promise.all([ledger.recover(`${device.origin}-r0`), ledger.recover(`${device.origin}-r0`)])
    const results = [first, second].filter(Boolean)
    expect(results).toHaveLength(1)
    expect(results[0]).toMatchObject({ refreshToken: `${device.origin}-r1`, accessToken: renewal(device.origin, 1, 'x').accessToken })
    await expect(ledger.recover(`${device.origin}-r0`)).resolves.toBeNull()

    const [row] = await db.query(`select recovery_sealed, recovered_at is not null as recovered from public.auth_refresh_tokens where token_hash = $1`, [refreshTokenHash(`${device.origin}-r0`)])
    expect(row).toEqual({ recovery_sealed: null, recovered: true })
    // check still says reused: recovery never changes what counts as reuse.
    await expect(ledger.check(`${device.origin}-r0`)).resolves.toBe('reused')
  })

  it('refuses once a request has carried the new access token (the session check marks it seen)', async () => {
    const device = await signedIn()
    const ledger = createRefreshTokenLedger({ query, recoveryKey })
    const next = renewal(device.origin, 1, `${device.origin}-r1`)
    await ledger.record({ previousRefreshToken: `${device.origin}-r0`, authentication: next })
    await pastGrace(`${device.origin}-r0`)

    // The request in which the proxy made the renewal does not count; the device's next request does.
    const guard = createSessionGuard({ repository: createSessionRepository({ query }) })
    await guard.check({ accessToken: next.accessToken, profileId: device.profileId, context, renewedInRequest: true })
    const [unseen] = await db.query(`select renewal_seen_at from public.auth_sessions where token_origin_hash = $1`, [device.originHash])
    expect(unseen!.renewal_seen_at).toBeNull()
    await guard.check({ accessToken: next.accessToken, profileId: device.profileId, context })
    const [seen] = await db.query(`select renewal_seen_at from public.auth_sessions where token_origin_hash = $1`, [device.originHash])
    expect(seen!.renewal_seen_at).not.toBeNull()

    await expect(ledger.recover(`${device.origin}-r0`)).resolves.toBeNull()
  })

  it('refuses past its expiry, and for a sign-in that was signed out or ended as reuse', async () => {
    const ledger = createRefreshTokenLedger({ query, recoveryKey })

    const expired = await signedIn()
    await ledger.record({ previousRefreshToken: `${expired.origin}-r0`, authentication: renewal(expired.origin, 1, `${expired.origin}-r1`) })
    await db.query(`update public.auth_refresh_tokens set recovery_expires_at = now() - interval '1 second' where token_hash = $1`, [refreshTokenHash(`${expired.origin}-r0`)])
    await expect(ledger.recover(`${expired.origin}-r0`)).resolves.toBeNull()

    const revoked = await signedIn()
    await ledger.record({ previousRefreshToken: `${revoked.origin}-r0`, authentication: renewal(revoked.origin, 1, `${revoked.origin}-r1`) })
    await createSessionRepository({ query }).revokeOthers(revoked.profileId, null, 'signed_out')
    await expect(ledger.recover(`${revoked.origin}-r0`)).resolves.toBeNull()

    const reused = await signedIn()
    await ledger.record({ previousRefreshToken: `${reused.origin}-r0`, authentication: renewal(reused.origin, 1, `${reused.origin}-r1`) })
    await ledger.endReused(`${reused.origin}-r1`)
    await expect(ledger.recover(`${reused.origin}-r0`)).resolves.toBeNull()

    // A set sealed with another key does not open: spent, and nothing is handed back.
    const otherKey = await signedIn()
    await ledger.record({ previousRefreshToken: `${otherKey.origin}-r0`, authentication: renewal(otherKey.origin, 1, `${otherKey.origin}-r1`) })
    const wrongKey = createRefreshTokenLedger({ query, recoveryKey: deriveAccountSecurityKey('another-placeholder-secret-long-enough-0000', 'refresh-recovery') })
    await expect(wrongKey.recover(`${otherKey.origin}-r0`)).resolves.toBeNull()
    // Without a key nothing is kept or recovered at all.
    const noKey = await signedIn()
    await createRefreshTokenLedger({ query }).record({ previousRefreshToken: `${noKey.origin}-r0`, authentication: renewal(noKey.origin, 1, `${noKey.origin}-r1`) })
    const [row] = await db.query(`select recovery_sealed from public.auth_refresh_tokens where token_hash = $1`, [refreshTokenHash(`${noKey.origin}-r0`)])
    expect(row!.recovery_sealed).toBeNull()
  })

  it('the new columns send no cache clears (the 0111 trigger only clears on a sign-in that ended)', async () => {
    const device = await signedIn()
    const tags: string[] = []
    const unlisten = await db.listen('sns_cache_clear', (payload) => tags.push(payload))
    const ledger = createRefreshTokenLedger({ query, recoveryKey })
    await ledger.record({ previousRefreshToken: `${device.origin}-r0`, authentication: renewal(device.origin, 1, `${device.origin}-r1`) })
    await createSessionRepository({ query }).markRenewalSeen(
      String((await db.query(`select id from public.auth_sessions where token_origin_hash = $1`, [device.originHash]))[0]!.id),
      accessTokenJtiHash(renewal(device.origin, 1, 'x').accessToken)!,
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(tags.filter((tag) => tag === `s:${device.originHash}`)).toEqual([])
    await ledger.endReused(`${device.origin}-r1`)
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(tags.filter((tag) => tag === `s:${device.originHash}`)).toEqual([`s:${device.originHash}`])
    await unlisten()
  })
})

/** A fake Cognito with rotation and the 60-second grace (as in two-device-sessions), recording each token it is sent. */
function fakeCognito(clock: { now: number }) {
  let next = 0
  const sent: string[] = []
  const tokens = new Map<string, { state: 'current' | 'rotated'; rotatedAt?: number; origin: string }>()
  return {
    sent,
    signIn(origin: string) {
      const token = `${origin}-c${next++}`
      tokens.set(token, { state: 'current', origin })
      return token
    },
    async refresh(refreshToken: string): Promise<CognitoAuthenticationResult> {
      sent.push(refreshToken)
      const token = tokens.get(refreshToken)
      if (!token) throw new CognitoApiError('NotAuthorizedException')
      if (token.state === 'rotated' && clock.now - token.rotatedAt! > 60_000) throw new CognitoApiError('RefreshTokenReuseException')
      token.state = 'rotated'
      token.rotatedAt ??= clock.now
      const child = `${token.origin}-c${next++}`
      tokens.set(child, { state: 'current', origin: token.origin })
      return { accessToken: accessToken(token.origin, `jti-${child}`), refreshToken: child, expiresIn: 3600 }
    },
  }
}

describe('refreshSession recovers a renewal the device never received (owner 19 Nov)', () => {
  async function device(cognito: ReturnType<typeof fakeCognito>) {
    const signed = await signedIn()
    return { ...signed, jar: new Map<string, string>([[COGNITO_COOKIE_NAMES.refresh, cognito.signIn(signed.origin)]]) }
  }

  function manager(jar: Map<string, string>, cognito: ReturnType<typeof fakeCognito>, counts: { recovered: number; reuse: number }, renew = createRefreshSingleFlight()) {
    return createCognitoSessionManager({
      cookieStore: {
        get: (name) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
        set: (name, value) => { jar.set(name, value) },
        delete: (name) => { jar.delete(name) },
      },
      api: { getUser: async () => ({ sub: 'placeholder-sub', email: null, emailVerified: true, name: null }), refresh: cognito.refresh },
      siteUrl: 'https://example.test',
      ledger: createRefreshTokenLedger({ query, recoveryKey, warn: () => undefined }),
      renew,
      onRefreshRecovered: () => { counts.recovered += 1 },
      onRefreshReuse: () => { counts.reuse += 1 },
    })
  }

  it('the response was lost (ALB 460): hours later the old token renews from the recovered one, counted, and never reaches Cognito', async () => {
    const clock = { now: 0 }
    const cognito = fakeCognito(clock)
    const laptop = await device(cognito)
    const counts = { recovered: 0, reuse: 0 }
    const oldToken = laptop.jar.get(COGNITO_COOKIE_NAMES.refresh)!

    // The server renews, but the laptop went to sleep: it never applies the response and keeps the old token.
    const lost = new Map(laptop.jar)
    await expect(manager(lost, cognito, counts).refreshSession()).resolves.toBe(true)
    const recoveredToken = lost.get(COGNITO_COOKIE_NAMES.refresh)!
    expect(recoveredToken).not.toBe(oldToken)
    expect(cognito.sent).toEqual([oldToken])

    // Hours later it wakes with the old token.
    clock.now += 3 * 60 * 60_000
    await pastGrace(oldToken)
    await expect(manager(laptop.jar, cognito, counts).refreshSession()).resolves.toBe(true)
    expect(counts).toEqual({ recovered: 1, reuse: 0 })
    // Cognito was sent the recovered token, never the old one again.
    expect(cognito.sent).toEqual([oldToken, recoveredToken])
    const now = laptop.jar.get(COGNITO_COOKIE_NAMES.refresh)!
    expect(now).not.toBe(oldToken)
    expect(now).not.toBe(recoveredToken)
    expect(laptop.jar.has(COGNITO_COOKIE_NAMES.access)).toBe(true)
    const [session] = await db.query(`select reuse_detected_at from public.auth_sessions where token_origin_hash = $1`, [laptop.originHash])
    expect(session!.reuse_detected_at).toBeNull()

    // The old token a second time (a copy someone else kept): not recoverable again, the sign-in ends as before.
    const copy = new Map<string, string>([[COGNITO_COOKIE_NAMES.refresh, oldToken]])
    await expect(manager(copy, cognito, counts).refreshSession()).resolves.toBe(false)
    expect(counts).toEqual({ recovered: 1, reuse: 1 })
    expect(copy.has(COGNITO_COOKIE_NAMES.refresh)).toBe(false)
    expect(cognito.sent).toEqual([oldToken, recoveredToken])
    const [ended] = await db.query(`select reuse_detected_at from public.auth_sessions where token_origin_hash = $1`, [laptop.originHash])
    expect(ended!.reuse_detected_at).not.toBeNull()
  })

  it('a laptop that wakes with several requests at once, over two servers, shares one recovery and stays signed in', async () => {
    const clock = { now: 0 }
    const cognito = fakeCognito(clock)
    const laptop = await device(cognito)
    const counts = { recovered: 0, reuse: 0 }
    const oldToken = laptop.jar.get(COGNITO_COOKIE_NAMES.refresh)!
    const lost = new Map(laptop.jar)
    await expect(manager(lost, cognito, counts).refreshSession()).resolves.toBe(true)
    const recoveredToken = lost.get(COGNITO_COOKIE_NAMES.refresh)!
    clock.now += 3 * 60 * 60_000
    await pastGrace(oldToken)

    const shared = createRefreshRenewalStore({ query, key: deriveAccountSecurityKey('placeholder-server-secret-that-is-long-enough-1234', 'refresh-renewal'), schedule: () => undefined })
    const servers = [createRefreshSingleFlight({ shared, pollMs: 5 }), createRefreshSingleFlight({ shared, pollMs: 5 })]
    const jars = [0, 1, 2].map(() => new Map(laptop.jar))
    const results = await Promise.all(jars.map((jar, i) => manager(jar, cognito, counts, servers[i % 2]).refreshSession()))
    expect(results).toEqual([true, true, true])
    expect(new Set(jars.map((jar) => jar.get(COGNITO_COOKIE_NAMES.refresh))).size).toBe(1)
    expect(cognito.sent).toEqual([oldToken, recoveredToken])
    expect(counts).toEqual({ recovered: 1, reuse: 0 })
    const [session] = await db.query(`select reuse_detected_at from public.auth_sessions where token_origin_hash = $1`, [laptop.originHash])
    expect(session!.reuse_detected_at).toBeNull()
  })

  it('falls back to ending the sign-in when the device did receive the renewal, or Cognito refuses the recovered token', async () => {
    const clock = { now: 0 }
    const cognito = fakeCognito(clock)
    const counts = { recovered: 0, reuse: 0 }

    // Received: its next request carried the new access token, so an old copy coming back is reuse.
    const phone = await device(cognito)
    const oldToken = phone.jar.get(COGNITO_COOKIE_NAMES.refresh)!
    const copy = new Map(phone.jar)
    await expect(manager(phone.jar, cognito, counts).refreshSession()).resolves.toBe(true)
    const guard = createSessionGuard({ repository: createSessionRepository({ query }) })
    await guard.check({ accessToken: phone.jar.get(COGNITO_COOKIE_NAMES.access)!, profileId: phone.profileId, context })
    clock.now += 2 * 60 * 60_000
    await pastGrace(oldToken)
    await expect(manager(copy, cognito, counts).refreshSession()).resolves.toBe(false)
    expect(counts).toEqual({ recovered: 0, reuse: 1 })
    expect(cognito.sent).toEqual([oldToken])
    const [ended] = await db.query(`select reuse_detected_at from public.auth_sessions where token_origin_hash = $1`, [phone.originHash])
    expect(ended!.reuse_detected_at).not.toBeNull()

    // Recovered, but Cognito refuses the recovered token (signed out everywhere in the meantime): cookies cleared, ended.
    const tablet = await device(cognito)
    const tabletOld = tablet.jar.get(COGNITO_COOKIE_NAMES.refresh)!
    await expect(manager(new Map(tablet.jar), cognito, counts).refreshSession()).resolves.toBe(true)
    await pastGrace(tabletOld)
    const refusing = { ...cognito, refresh: vi.fn<(refreshToken: string) => Promise<CognitoAuthenticationResult>>(async () => { throw new CognitoApiError('NotAuthorizedException') }) }
    await expect(manager(tablet.jar, refusing, counts).refreshSession()).resolves.toBe(false)
    expect(refusing.refresh).toHaveBeenCalledTimes(1)
    expect(refusing.refresh.mock.calls[0]![0]).not.toBe(tabletOld)
    expect(tablet.jar.has(COGNITO_COOKIE_NAMES.refresh)).toBe(false)
    expect(counts).toEqual({ recovered: 0, reuse: 2 })
    const [tabletEnded] = await db.query(`select reuse_detected_at from public.auth_sessions where token_origin_hash = $1`, [tablet.originHash])
    expect(tabletEnded!.reuse_detected_at).not.toBeNull()
  })
})

describe('before migration 0112 is applied', () => {
  it('renews, checks and guards sessions as before, with no warnings', async () => {
    const old = await createTestDatabase({ skipMigrations: ['0112_refresh_recovery.sql'] })
    try {
      const oldQuery: AccountQuery = (text, values) => old.query(text, values) as Promise<Array<Record<string, unknown>>>
      const warnings: string[] = []
      const ledger = createRefreshTokenLedger({ query: oldQuery, recoveryKey, warn: (tag) => warnings.push(tag) })
      const rows = await old.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Member') returning id`)
      const guard = createSessionGuard({ repository: createSessionRepository({ query: oldQuery }), warn: (tag) => warnings.push(tag) })
      const next = renewal('origin-before-0112', 1, 'before-r1')
      await expect(guard.check({ accessToken: next.accessToken, profileId: String(rows[0]!.id), context })).resolves.toMatchObject({ status: 'active' })
      await ledger.record({ previousRefreshToken: 'before-r0', authentication: next })
      await old.query(`update public.auth_refresh_tokens set superseded_at = now() - interval '2 hours'`)
      await expect(ledger.check('before-r0')).resolves.toBe('reused')
      await expect(ledger.recover('before-r0')).resolves.toBeNull()
      expect(warnings).toEqual([])
    } finally {
      await old.close()
    }
  }, 120_000)
})

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { renewalTokenHash } from '@/lib/auth/refresh-single-flight'
import { deriveAccountSecurityKey } from './keys'
import { createRefreshRenewalStore, sealRenewal, unsealRenewal } from './refresh-renewals'
import type { AccountQuery } from './types'

/**
 * Owner-approved 15 Nov, against the real schema (PGlite with every migration, including 0104): the shared store for
 * one renewal per refresh token. Placeholder tokens only.
 */
let db: TestDatabase
const query: AccountQuery = (text, values) => db.query(text, values) as Promise<Array<Record<string, unknown>>>
const key = deriveAccountSecurityKey('placeholder-server-secret-that-is-long-enough-1234', 'refresh-renewal')!
const otherKey = deriveAccountSecurityKey('placeholder-server-secret-that-is-long-enough-1234', 'session-ip')!
const renewed = { accessToken: 'placeholder-access-token', idToken: 'placeholder-id-token', refreshToken: 'placeholder-new-refresh-token', expiresIn: 3600 }

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

function store(options: { scheduled?: Array<() => void>; now?: () => number } = {}) {
  return createRefreshRenewalStore({
    query,
    key,
    now: options.now,
    schedule: (work) => { options.scheduled?.push(work) },
  })!
}

describe('auth_refresh_renewals (sealed, 60 seconds)', () => {
  it('keeps the renewed tokens only sealed, keyed by a hash, and hands them to another server', async () => {
    const tokenHash = renewalTokenHash('placeholder-old-refresh-token')
    const serverA = store()
    const serverB = store()
    expect(await serverB.read(tokenHash)).toEqual({ state: 'none' })
    expect(await serverA.claim(tokenHash)).toBe(true)
    expect(await serverB.claim(tokenHash)).toBe(false)
    expect(await serverB.read(tokenHash)).toEqual({ state: 'pending' })
    await serverA.publish(tokenHash, renewed)
    expect(await serverB.read(tokenHash)).toEqual({ state: 'ready', authentication: renewed })

    const rows = await db.query(`select * from public.auth_refresh_renewals`)
    expect(rows).toHaveLength(1)
    const stored = JSON.stringify(rows)
    expect(stored).not.toContain('placeholder-old-refresh-token')
    expect(stored).not.toContain('placeholder-new-refresh-token')
    expect(stored).not.toContain('placeholder-access-token')
    expect(stored).not.toContain('placeholder-id-token')
    expect(rows[0]!.token_hash).toBe(tokenHash)
  })

  it('never reads a row past its 60 seconds, deletes it then, and every claim clears rows a missed delete left', async () => {
    const scheduled: Array<() => void> = []
    const renewals = store({ scheduled })
    const tokenHash = renewalTokenHash('placeholder-expiring-token')
    expect(await renewals.claim(tokenHash)).toBe(true)
    await renewals.publish(tokenHash, renewed)
    expect(scheduled).toHaveLength(1)
    // Its 60 seconds pass.
    await db.query(`update public.auth_refresh_renewals set expires_at = now() - interval '1 second' where token_hash = $1`, [tokenHash])
    expect(await renewals.read(tokenHash)).toEqual({ state: 'none' })
    scheduled[0]!()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(await db.query(`select 1 from public.auth_refresh_renewals where token_hash = $1`, [tokenHash])).toHaveLength(0)

    // A row whose delete was missed (its server stopped) is cleared by the next claim for any token.
    const missed = renewalTokenHash('placeholder-missed-delete')
    await db.query(`insert into public.auth_refresh_renewals (token_hash, sealed, expires_at) values ($1, 'v1.x.y.z', now() - interval '5 minutes')`, [missed])
    expect(await renewals.claim(renewalTokenHash('placeholder-next-token'))).toBe(true)
    expect(await db.query(`select 1 from public.auth_refresh_renewals where token_hash = $1`, [missed])).toHaveLength(0)
  })

  it('a released claim (failed renewal) is gone, and a claim abandoned for 10 seconds can be taken over', async () => {
    const renewals = store()
    const failed = renewalTokenHash('placeholder-failed-token')
    expect(await renewals.claim(failed)).toBe(true)
    await renewals.release(failed)
    expect(await renewals.read(failed)).toEqual({ state: 'none' })

    const abandoned = renewalTokenHash('placeholder-abandoned-token')
    expect(await renewals.claim(abandoned)).toBe(true)
    expect(await renewals.claim(abandoned)).toBe(false)
    await db.query(`update public.auth_refresh_renewals set claimed_at = now() - interval '11 seconds' where token_hash = $1`, [abandoned])
    expect(await renewals.claim(abandoned)).toBe(true)

    // A published renewal is never taken over, however old its claim.
    const done = renewalTokenHash('placeholder-done-token')
    expect(await renewals.claim(done)).toBe(true)
    await renewals.publish(done, renewed)
    await db.query(`update public.auth_refresh_renewals set claimed_at = now() - interval '30 seconds' where token_hash = $1`, [done])
    expect(await renewals.claim(done)).toBe(false)
    expect(await renewals.read(done)).toEqual({ state: 'ready', authentication: renewed })
  })

  it('a seal opens only with its key and for its own row, and the access token lifetime counts from when it was issued', () => {
    const tokenHash = renewalTokenHash('placeholder-a')
    const sealed = sealRenewal(key, tokenHash, renewed, 1_000_000)
    expect(sealed).not.toContain('placeholder')
    expect(unsealRenewal(key, tokenHash, sealed, 1_000_000)).toEqual(renewed)
    expect(unsealRenewal(key, tokenHash, sealed, 1_000_000 + 30_000)?.expiresIn).toBe(3570)
    expect(unsealRenewal(otherKey, tokenHash, sealed, 1_000_000)).toBeNull()
    expect(unsealRenewal(key, renewalTokenHash('placeholder-b'), sealed, 1_000_000)).toBeNull()
    expect(unsealRenewal(key, tokenHash, `${sealed.slice(0, -2)}AA`, 1_000_000)).toBeNull()
  })

  it('without the key there is no shared store', () => {
    expect(createRefreshRenewalStore({ query, key: null })).toBeUndefined()
  })
})

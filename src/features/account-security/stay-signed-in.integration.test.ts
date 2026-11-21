import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createAppHandoffService, APP_HANDOFF_MAX_CODE_ATTEMPTS } from '@/features/auth/app-handoff'
import { createRefreshTokenLedger, refreshTokenHash } from './refresh-token-ledger'
import { createSessionGuard } from './session-guard'
import { createSessionRepository } from './session-repository'
import type { AccountQuery } from './types'

/**
 * Round I (I3) against the real schema (PGlite with every migration, including 0092): refresh token rotation and
 * reuse detection, and the Home Screen app's Google handoff. Placeholder data only.
 */
let db: TestDatabase
const query: AccountQuery = (text, values) => db.query(text, values) as Promise<Array<Record<string, unknown>>>
const context = () => ({ userAgentSummary: 'Home Screen app on iPhone', city: null, country: null, ip: null })

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

function accessToken(originJti: string) {
  return `eyJhbGciOiJub25lIn0.${Buffer.from(JSON.stringify({ origin_jti: originJti, scope: 'aws.cognito.signin.user.admin' })).toString('base64url')}.signature`
}

async function profile() {
  const rows = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Member') returning id`)
  return String(rows[0]!.id)
}

describe('refresh token rotation and reuse (auth_refresh_tokens)', () => {
  it('ends the sign-in when a refresh token comes back after it was rotated out, but not within the grace period', async () => {
    const profileId = await profile()
    const repository = createSessionRepository({ query })
    const guard = createSessionGuard({ repository })
    const warnings: string[] = []
    const ledger = createRefreshTokenLedger({ query, warn: (tag) => warnings.push(tag) })
    const token = accessToken('origin-rotation-0001')
    await expect(guard.check({ accessToken: token, profileId, context })).resolves.toMatchObject({ status: 'active' })

    await expect(ledger.check('refresh-a')).resolves.toBe('ok')
    await ledger.record({ previousRefreshToken: 'refresh-a', authentication: { accessToken: token, refreshToken: 'refresh-b', expiresIn: 3600 } })
    const stored = await db.query(`select token_hash, superseded_at is not null as retired from public.auth_refresh_tokens order by retired desc`)
    // Only hashes are kept, never the tokens.
    expect(stored).toEqual([
      { token_hash: refreshTokenHash('refresh-a'), retired: true },
      { token_hash: refreshTokenHash('refresh-b'), retired: false },
    ])
    expect(JSON.stringify(stored)).not.toContain('refresh-a')

    // Parallel page loads with the old token, inside the grace period, are not reuse.
    await expect(ledger.check('refresh-a')).resolves.toBe('ok')
    await expect(ledger.check('refresh-b')).resolves.toBe('ok')

    await db.query(`update public.auth_refresh_tokens set superseded_at = now() - interval '2 minutes' where token_hash = $1`, [refreshTokenHash('refresh-a')])
    await expect(ledger.check('refresh-a')).resolves.toBe('reused')
    // Owner (19 Nov): check only reports; with nothing to recover (no recovery key here), endReused ends the sign-in.
    expect(warnings).toEqual([])
    await expect(ledger.recover('refresh-a')).resolves.toBeNull()
    await ledger.endReused('refresh-a')
    expect(warnings).toEqual(['[auth_refresh_reuse]'])

    // Every token of that sign-in is refused now, on every server: the member's current one too.
    const otherServer = createSessionGuard({ repository: createSessionRepository({ query }) })
    await expect(otherServer.check({ accessToken: token, profileId, context })).resolves.toMatchObject({ status: 'revoked', reason: 'refresh_reuse' })
    await expect(repository.listActive(profileId)).resolves.toEqual([])
  })

  it('records nothing when Cognito did not rotate, and never fails a refresh on its own errors', async () => {
    const ledger = createRefreshTokenLedger({ query })
    await ledger.record({ previousRefreshToken: 'same-token', authentication: { accessToken: accessToken('origin-rotation-0002'), expiresIn: 3600 } })
    await expect(db.query(`select 1 from public.auth_refresh_tokens where token_hash = $1`, [refreshTokenHash('same-token')])).resolves.toEqual([])

    const warnings: string[] = []
    const broken = createRefreshTokenLedger({ query: async () => { throw Object.assign(new Error('down'), { code: '08006' }) }, warn: (tag) => warnings.push(tag) })
    await expect(broken.check('refresh-x')).resolves.toBe('ok')
    await expect(broken.record({ previousRefreshToken: 'refresh-x', authentication: { accessToken: accessToken('origin-rotation-0003'), refreshToken: 'refresh-y', expiresIn: 3600 } })).resolves.toBeUndefined()
    expect(warnings).toEqual(['[auth_refresh_ledger_unavailable]', '[auth_refresh_ledger_unavailable]'])
  })
})

describe('Home Screen app Google handoff (auth_app_handoffs)', () => {
  const KEY = Buffer.alloc(32, 9)
  let codes = 0
  const service = () => createAppHandoffService({ query, key: KEY, pairCode: () => String(482193 + (codes += 1)).padStart(6, '0') })

  it('hands the authorization code to the app once, after the code it shows is typed in Safari', async () => {
    const handoffs = service()
    const started = await handoffs.start({ state: 'state-0001', intent: 'sign-in' })
    await expect(handoffs.claim(started)).resolves.toEqual({ status: 'waiting' })

    // Google comes back in Safari, without the app's cookies.
    const callback = await handoffs.recordCallback({ state: 'state-0001', authorizationCode: 'cognito-code-1' })
    expect(callback).not.toBeNull()
    await expect(handoffs.claim(started)).resolves.toEqual({ status: 'confirm' })
    await expect(handoffs.recordCallback({ state: 'state-0001', authorizationCode: 'cognito-code-2' })).resolves.toBeNull()

    await expect(handoffs.confirm({ id: callback!.id, confirmSecret: callback!.confirmSecret, code: '000000' })).resolves.toBe('wrong')
    // Only the Safari window that came back from Google can confirm.
    await expect(handoffs.confirm({ id: callback!.id, confirmSecret: 'x'.repeat(43), code: started.pairCode })).resolves.toBe('expired')
    await expect(handoffs.confirm({ id: callback!.id, confirmSecret: callback!.confirmSecret, code: started.pairCode })).resolves.toBe('ready')

    // Only the app (its secret) can claim, and only once; the code is cleared.
    await expect(handoffs.claim({ id: started.id, secret: 'y'.repeat(43) })).resolves.toEqual({ status: 'expired' })
    await expect(handoffs.claim(started)).resolves.toEqual({ status: 'ready', authorizationCode: 'cognito-code-1', intent: 'sign-in' })
    await expect(handoffs.claim(started)).resolves.toEqual({ status: 'expired' })
    const [row] = await db.query(`select status, auth_code from public.auth_app_handoffs where id = $1`, [started.id])
    expect(row).toEqual({ status: 'claimed', auth_code: null })
  })

  it('stops after too many wrong codes, refuses an unknown state and an expired handoff, and fails closed without a key', async () => {
    const handoffs = service()
    const started = await handoffs.start({ state: 'state-0002', intent: 'sign-up' })
    const callback = (await handoffs.recordCallback({ state: 'state-0002', authorizationCode: 'cognito-code-3' }))!
    for (let attempt = 1; attempt < APP_HANDOFF_MAX_CODE_ATTEMPTS; attempt += 1) {
      await expect(handoffs.confirm({ ...callback, code: '111111' })).resolves.toBe('wrong')
    }
    await expect(handoffs.confirm({ ...callback, code: '111111' })).resolves.toBe('refused')
    await expect(handoffs.confirm({ ...callback, code: started.pairCode })).resolves.toBe('refused')
    await expect(handoffs.claim(started)).resolves.toEqual({ status: 'refused' })

    await expect(handoffs.recordCallback({ state: 'never-started', authorizationCode: 'code' })).resolves.toBeNull()

    const late = await handoffs.start({ state: 'state-0003', intent: 'sign-in' })
    await db.query(`update public.auth_app_handoffs set expires_at = now() - interval '1 second' where id = $1`, [late.id])
    await expect(handoffs.recordCallback({ state: 'state-0003', authorizationCode: 'code' })).resolves.toBeNull()
    await expect(handoffs.claim(late)).resolves.toEqual({ status: 'expired' })

    await expect(createAppHandoffService({ query, key: null }).start({ state: 'state-0004', intent: 'sign-in' })).rejects.toThrow('app_handoff_unavailable')
  })
})

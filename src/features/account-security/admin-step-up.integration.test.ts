import { createHash } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import type { CurrentMfaStatus } from '@/features/auth/mfa'
import { ADMIN_STEP_UP_MAX_FAILURES, ADMIN_STEP_UP_MESSAGES, createAdminStepUp, sessionHasAdminStepUp } from './admin-step-up'

/**
 * Hotfix P1: the admin step-up for Google sign-ins against the real schema (all migrations, PGlite), with Cognito
 * faked: password and authenticator code (or a backup code), Cognito answering for the same account, the session
 * marked, a wrong code refused and counted, and the 6th failed attempt in 15 minutes refused before Cognito.
 */

let db: TestDatabase
let profileId: string
let sessionId: string

const USERNAME = '0f1e2d3c-4b5a-4987-8a6b-5c4d3e2f1a0b'
const EMAIL = 'admin@example.invalid'
const PASSWORD = 'Correct-Horse-9'
const google: CurrentMfaStatus = { kind: 'eligible', enabled: true, email: EMAIL, hostedSession: true }

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(async () => {
  const [profile] = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Fixture Admin') returning id`)
  profileId = profile!.id as string
  const origin = createHash('sha256').update(`origin-${profileId}`).digest('hex')
  const [session] = await db.query(`insert into public.auth_sessions (profile_id, token_origin_hash, sign_in_method) values ($1, $2, 'google') returning id`, [profileId, origin])
  sessionId = session!.id as string
})

function fakeApi(options: { password?: string; code?: string; username?: string; noChallenge?: boolean } = {}) {
  return {
    signIn: vi.fn(async (input: { username: string; password: string }) => {
      if (input.password !== (options.password ?? PASSWORD)) throw new CognitoApiError('NotAuthorizedException')
      if (options.noChallenge) return { kind: 'authenticated' as const, authentication: { accessToken: 'a', refreshToken: 'stray-refresh', expiresIn: 3600 } }
      return { kind: 'software-token-mfa' as const, session: 'challenge-session', username: options.username ?? USERNAME }
    }),
    respondToSoftwareTokenMfa: vi.fn(async (input: { code: string }) => {
      if (input.code !== (options.code ?? '123456')) throw new CognitoApiError('CodeMismatchException')
      return { accessToken: 'step-up-access', refreshToken: 'step-up-refresh', expiresIn: 3600 }
    }),
    revokeToken: vi.fn(async () => undefined),
  }
}

function stepUp(overrides: Partial<Parameters<typeof createAdminStepUp>[0]> = {}) {
  const api = (overrides.api as ReturnType<typeof fakeApi>) ?? fakeApi()
  const audit = vi.fn(async () => undefined)
  const consumeBackupCode = vi.fn(async (code: string) => code === 'ABCDE23456')
  const run = createAdminStepUp({
    profileId,
    isPlatformAdministrator: async () => true,
    getAccount: async () => ({ username: USERNAME, status: google }),
    currentSessionId: async () => sessionId,
    consumeBackupCode,
    query: (text, values) => db.query(text, values),
    audit,
    ...overrides,
    api,
  })
  return { run, api, audit, consumeBackupCode }
}

async function marked() {
  return sessionHasAdminStepUp((text, values) => db.query(text, values), { profileId, sessionId })
}

async function attempts() {
  const rows = await db.query(`select succeeded from public.admin_step_up_attempts where profile_id = $1 order by id`, [profileId])
  return rows.map((row) => row.succeeded)
}

describe('admin step-up for a Google sign-in (hotfix P1)', () => {
  it('password plus a valid authenticator code marks this sign-in, revokes the check’s tokens and is audited', async () => {
    const { run, api, audit } = stepUp()
    expect(await marked()).toBe(false)
    expect(await run({ method: 'authenticator', password: PASSWORD, code: '123 456' })).toEqual({ status: 'verified' })
    expect(api.signIn).toHaveBeenCalledWith({ username: EMAIL, password: PASSWORD })
    expect(api.respondToSoftwareTokenMfa).toHaveBeenCalledWith({ username: USERNAME, session: 'challenge-session', code: '123456' })
    expect(api.revokeToken).toHaveBeenCalledWith('step-up-refresh')
    expect(await marked()).toBe(true)
    expect(await attempts()).toEqual([true])
    expect(audit).toHaveBeenCalledWith('authenticator')
  })

  it('a backup code works instead of the app code, once', async () => {
    const { run, api, consumeBackupCode } = stepUp()
    expect(await run({ method: 'backup_code', password: PASSWORD, code: 'abcde-23456' })).toEqual({ status: 'verified' })
    expect(consumeBackupCode).toHaveBeenCalledWith('ABCDE23456')
    expect(api.respondToSoftwareTokenMfa).not.toHaveBeenCalled()
    expect(await marked()).toBe(true)
  })

  it('a wrong code is refused and counted; the 6th failed attempt in 15 minutes is refused before Cognito is asked', async () => {
    const { run, api } = stepUp()
    for (let attempt = 0; attempt < ADMIN_STEP_UP_MAX_FAILURES; attempt += 1) {
      expect(await run({ method: 'authenticator', password: PASSWORD, code: '000000' })).toEqual({ status: 'error', error: ADMIN_STEP_UP_MESSAGES.wrongCode, field: 'code' })
    }
    expect(await attempts()).toEqual([false, false, false, false, false])
    api.signIn.mockClear()
    expect(await run({ method: 'authenticator', password: PASSWORD, code: '123456' })).toEqual({ status: 'error', error: ADMIN_STEP_UP_MESSAGES.tooMany })
    expect(api.signIn).not.toHaveBeenCalled()
    expect(await marked()).toBe(false)
    // Attempts older than the window no longer count.
    await db.query(`update public.admin_step_up_attempts set created_at = now() - interval '16 minutes' where profile_id = $1`, [profileId])
    expect(await run({ method: 'authenticator', password: PASSWORD, code: '123456' })).toEqual({ status: 'verified' })
  })

  it('refuses a wrong password, another account’s answer, a wrong backup code, and an account Cognito no longer asks for its app', async () => {
    expect(await stepUp().run({ method: 'authenticator', password: 'wrong', code: '123456' })).toMatchObject({ status: 'error', error: ADMIN_STEP_UP_MESSAGES.wrongPassword, field: 'password' })
    expect(await stepUp({ api: fakeApi({ username: 'someone-else' }) }).run({ method: 'authenticator', password: PASSWORD, code: '123456' })).toMatchObject({ error: ADMIN_STEP_UP_MESSAGES.otherAccount })
    expect(await stepUp().run({ method: 'backup_code', password: PASSWORD, code: 'ZZZZZ99999' })).toMatchObject({ error: ADMIN_STEP_UP_MESSAGES.wrongBackupCode, field: 'code' })
    const noApp = fakeApi({ noChallenge: true })
    expect(await stepUp({ api: noApp }).run({ method: 'authenticator', password: PASSWORD, code: '123456' })).toMatchObject({ error: ADMIN_STEP_UP_MESSAGES.noAuthenticator })
    expect(noApp.revokeToken).toHaveBeenCalledWith('stray-refresh')
    expect(await marked()).toBe(false)
  })

  it('keeps the rule that admins need an authenticator app, and is only for administrators', async () => {
    const federated = stepUp({ getAccount: async () => ({ username: 'Google_1234', status: { ...google, kind: 'federated' } }) })
    expect(await federated.run({ method: 'authenticator', password: PASSWORD, code: '123456' })).toMatchObject({ error: ADMIN_STEP_UP_MESSAGES.federated })
    expect(federated.api.signIn).not.toHaveBeenCalled()
    const noApp = stepUp({ getAccount: async () => ({ username: USERNAME, status: { ...google, enabled: false } }) })
    expect(await noApp.run({ method: 'authenticator', password: PASSWORD, code: '123456' })).toMatchObject({ error: ADMIN_STEP_UP_MESSAGES.noAuthenticator })
    const member = stepUp({ isPlatformAdministrator: async () => false })
    expect(await member.run({ method: 'authenticator', password: PASSWORD, code: '123456' })).toMatchObject({ error: ADMIN_STEP_UP_MESSAGES.notAdmin })
    // Checked before anything is sent: an empty password or a malformed code.
    expect(await stepUp().run({ method: 'authenticator', password: '', code: '123456' })).toMatchObject({ field: 'password' })
    expect(await stepUp().run({ method: 'authenticator', password: PASSWORD, code: '12ab' })).toMatchObject({ error: ADMIN_STEP_UP_MESSAGES.codeInvalid })
    expect(await attempts()).toEqual([])
  })

  it('lasts for this sign-in only: another session, or this one after sign-out, is not stepped up', async () => {
    await stepUp().run({ method: 'authenticator', password: PASSWORD, code: '123456' })
    const origin = createHash('sha256').update(`other-${profileId}`).digest('hex')
    const [other] = await db.query(`insert into public.auth_sessions (profile_id, token_origin_hash, sign_in_method) values ($1, $2, 'google') returning id`, [profileId, origin])
    const query = (text: string, values?: readonly unknown[]) => db.query(text, values)
    expect(await sessionHasAdminStepUp(query, { profileId, sessionId: other!.id as string })).toBe(false)
    await db.query(`update public.auth_sessions set revoked_at = now(), revoke_reason = 'signed_out' where id = $1`, [sessionId])
    expect(await marked()).toBe(false)
  })

  it('a password sign-in already has admin MFA and needs no step-up', async () => {
    const { run, api } = stepUp({ getAccount: async () => ({ username: USERNAME, status: { ...google, hostedSession: false } }) })
    expect(await run({ method: 'authenticator', password: PASSWORD, code: '123456' })).toEqual({ status: 'verified' })
    expect(api.signIn).not.toHaveBeenCalled()
  })
})

describe('migration 0095', () => {
  it('sets the minimum payout default to 10000000 paise (Rs 1,00,000)', async () => {
    const rows = await db.query(`select column_default from information_schema.columns where table_schema = 'public' and table_name = 'payout_settings' and column_name = 'min_payout_minor'`)
    expect(rows[0]!.column_default).toBe('10000000')
  })
})

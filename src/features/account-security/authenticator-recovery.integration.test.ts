import { createHash, randomBytes } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import type { CurrentMfaStatus } from '@/features/auth/mfa'
import { createAdminMfaReset } from './admin-mfa-reset'
import { createAuthenticatorReplacement, issueReplacementPass, REPLACEMENT_MESSAGES, verifyReplacementPass } from './authenticator-replacement'
import { createBackupCodeRepository } from './backup-codes'
import { createBackupCodeReminder } from './backup-code-reminder'
import { createSessionRepository } from './session-repository'

/**
 * Admin two-step (owner, 21 Nov), against the real schema (PGlite, every migration) with a fake Cognito:
 * - a platform administrator resets a locked-out member's two-step verification (guards, Cognito off, unused backup
 *   codes gone, every session signed out, audited, emailed; a Cognito refusal changes nothing);
 * - a member replaces their authenticator app after confirming it is them (password and current code or backup
 *   code), with a pass for this session only, the other sessions signed out, audited and emailed;
 * - admins without unused backup codes get a reminder. Placeholder data only.
 */
let db: TestDatabase
type Row = Record<string, unknown>
const run = (text: string, values?: readonly unknown[]) => db.query(text, values ? [...values] : undefined) as Promise<Row[]>
const transaction = async <T,>(work: (query: typeof run) => Promise<T>) => db.transaction((query) => work(query as typeof run))
const key = randomBytes(32)
let sequence = 0

async function member(name: string, options: { admin?: boolean; email?: string | null } = {}) {
  sequence += 1
  const id = String((await run(
    `insert into public.profiles (id, full_name, slug) values (gen_random_uuid(), $1, $2) returning id`,
    [name, `placeholder-member-${sequence}`],
  ))[0]!.id)
  if (options.admin) await run(`insert into public.user_roles (user_id, role) values ($1, 'administrator')`, [id])
  if (options.email !== null) {
    await run(
      `insert into public.identity_accounts (profile_id, provider, provider_subject, email, email_verified) values ($1, 'cognito', $2, $3, true)`,
      [id, `placeholder-sub-${sequence}`, options.email ?? `member${sequence}@placeholder.example`],
    )
  }
  return { id, slug: `placeholder-member-${sequence}`, sub: `placeholder-sub-${sequence}` }
}

async function session(profileId: string) {
  const origin = createHash('sha256').update(`origin-${profileId}-${Math.random()}`).digest('hex')
  return String((await run(`insert into public.auth_sessions (profile_id, token_origin_hash, sign_in_method) values ($1, $2, 'password') returning id`, [profileId, origin]))[0]!.id)
}

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('super-admin reset of two-step verification', () => {
  function reset(overrides: { disable?: (username: string) => Promise<void> } = {}) {
    const disabled: string[] = []
    const notices: Array<{ to: string | null }> = []
    const markRevoked = vi.fn()
    const run = createAdminMfaReset({
      transaction,
      disableSoftwareTokenMfa: overrides.disable ?? (async (username) => { disabled.push(username) }),
      revokeAllSessions: (query, profileId) => createSessionRepository({ query }).revokeOthers(profileId, null, 'mfa_reset'),
      markRevoked,
      sendNotice: async (notice) => { notices.push(notice); return true },
    })
    return { run, disabled, notices, markRevoked }
  }

  it('refuses non-administrators, yourself, a short reason and a wrong confirmation', async () => {
    const admin = await member('Placeholder Admin', { admin: true })
    const target = await member('Placeholder Partner')
    const other = await member('Placeholder Member')
    const { run: resetNow, disabled } = reset()
    expect(await resetNow({ adminId: other.id, profileId: target.id, reason: 'Lost phone, identity checked.', confirmUsername: target.slug })).toEqual({ status: 'error', code: 'admin_forbidden' })
    expect(await resetNow({ adminId: admin.id, profileId: admin.id, reason: 'Lost phone, identity checked.', confirmUsername: admin.slug })).toEqual({ status: 'error', code: 'own_account' })
    expect(await resetNow({ adminId: admin.id, profileId: target.id, reason: 'short', confirmUsername: target.slug })).toEqual({ status: 'error', code: 'reason_required' })
    expect(await resetNow({ adminId: admin.id, profileId: target.id, reason: 'Lost phone, identity checked.', confirmUsername: 'someone-else' })).toEqual({ status: 'error', code: 'confirmation_mismatch' })
    const googleOnly = await member('Placeholder Google', { email: null })
    expect(await resetNow({ adminId: admin.id, profileId: googleOnly.id, reason: 'Lost phone, identity checked.', confirmUsername: googleOnly.slug })).toEqual({ status: 'error', code: 'no_cognito_sign_in' })
    expect(disabled).toEqual([])
  })

  it('turns the app off, deletes unused backup codes, signs out everywhere, audits and emails', async () => {
    const admin = await member('Placeholder Admin', { admin: true })
    const target = await member('Placeholder Partner', { email: 'partner@placeholder.example' })
    await createBackupCodeRepository({ query: run }).replaceBatch(target.id, key)
    const [s1, s2] = [await session(target.id), await session(target.id)]
    const { run: resetNow, disabled, notices, markRevoked } = reset()

    const result = await resetNow({ adminId: admin.id, profileId: target.id, reason: 'Lost phone, identity checked by call.', confirmUsername: `@${target.slug.toUpperCase()}` })
    expect(result).toEqual({ status: 'reset', sessionsSignedOut: 2, emailed: true })
    expect(disabled).toEqual([target.sub])
    expect(await run(`select count(*)::int as n from public.mfa_backup_codes where profile_id = $1 and used_at is null`, [target.id])).toEqual([{ n: 0 }])
    expect(await run(`select count(*)::int as n from public.auth_sessions where profile_id = $1 and revoked_at is null`, [target.id])).toEqual([{ n: 0 }])
    expect(markRevoked).toHaveBeenCalledWith(expect.arrayContaining([s1, s2]))
    expect(notices).toEqual([expect.objectContaining({ to: 'partner@placeholder.example' })])
    const [audit] = await run(`select actor_id, metadata from public.audit_events where action = 'account.mfa_reset_by_admin' and target_id = $1`, [target.id])
    expect(audit).toMatchObject({ actor_id: admin.id, metadata: expect.objectContaining({ reason: 'Lost phone, identity checked by call.', sessionsSignedOut: 2 }) })
    expect(await run(`select 1 from public.audit_events where action = 'account.mfa_reset' and actor_id = $1`, [target.id])).toHaveLength(1)
  })

  it('changes nothing when Cognito refuses', async () => {
    const admin = await member('Placeholder Admin', { admin: true })
    const target = await member('Placeholder Partner')
    await createBackupCodeRepository({ query: run }).replaceBatch(target.id, key)
    await session(target.id)
    const { run: resetNow, notices } = reset({ disable: async () => { throw new CognitoApiError('InternalErrorException') } })
    await expect(resetNow({ adminId: admin.id, profileId: target.id, reason: 'Lost phone, identity checked.', confirmUsername: target.slug })).rejects.toThrow()
    expect(await run(`select count(*)::int as n from public.mfa_backup_codes where profile_id = $1 and used_at is null`, [target.id])).toEqual([{ n: 10 }])
    expect(await run(`select count(*)::int as n from public.auth_sessions where profile_id = $1 and revoked_at is null`, [target.id])).toEqual([{ n: 1 }])
    expect(await run(`select 1 from public.audit_events where action = 'account.mfa_reset_by_admin' and target_id = $1`, [target.id])).toEqual([])
    expect(notices).toEqual([])
  })
})

describe('replacing the authenticator app', () => {
  const PASSWORD = 'Correct-Horse-9'
  const status: CurrentMfaStatus = { kind: 'eligible', enabled: true, email: 'admin@placeholder.example', hostedSession: false }

  function fakeApi(username: string) {
    return {
      signIn: vi.fn(async (input: { username: string; password: string }) => {
        if (input.password !== PASSWORD) throw new CognitoApiError('NotAuthorizedException')
        return { kind: 'software-token-mfa' as const, session: 'challenge', username }
      }),
      respondToSoftwareTokenMfa: vi.fn(async (input: { code: string }) => {
        if (input.code !== '123456') throw new CognitoApiError('CodeMismatchException')
        return { accessToken: 'check-access', refreshToken: 'check-refresh', expiresIn: 3600 }
      }),
      revokeToken: vi.fn(async () => undefined),
      associateSoftwareToken: vi.fn(async () => ({ secretCode: 'NEWSECRETKEY' })),
      verifySoftwareToken: vi.fn(async (input: { code: string }) => ({ status: input.code === '654321' ? 'SUCCESS' : 'ERROR' })),
      setSoftwareTokenMfaPreference: vi.fn(async () => undefined),
    }
  }

  async function setup(options: { enabled?: boolean; now?: () => number } = {}) {
    const person = await member('Placeholder Admin', { admin: true })
    const current = await session(person.id)
    const other = await session(person.id)
    const api = fakeApi(person.sub)
    const notices: Array<{ to: string | null }> = []
    const replacement = createAuthenticatorReplacement({
      enabled: options.enabled ?? true,
      profileId: person.id,
      key,
      now: options.now,
      getAccessToken: async () => 'session-access',
      getAccount: async () => ({ username: person.sub, status }),
      currentSessionId: async () => current,
      api,
      consumeBackupCode: async (code) => code === 'ABCDE23456',
      query: run,
      renderQr: async () => 'data:image/png;base64,QR',
      finish: (sessionId) => transaction(async (query) => {
        const revoked = await createSessionRepository({ query }).revokeOthers(person.id, sessionId, 'mfa_reset')
        await query(`insert into public.audit_events (actor_id, action, target_type, target_id, metadata) values ($1::uuid, 'account.mfa_replaced', 'profile', $1::text, '{}'::jsonb)`, [person.id])
        return revoked
      }),
      sendNotice: async (notice) => { notices.push(notice); return true },
    })
    return { person, current, other, api, replacement, notices }
  }

  it('does nothing until it is switched on', async () => {
    const { replacement, api } = await setup({ enabled: false })
    expect(await replacement.confirm({ method: 'authenticator', password: PASSWORD, code: '123456' })).toEqual({ status: 'error', error: REPLACEMENT_MESSAGES.off })
    expect(await replacement.start('anything')).toEqual({ status: 'error', error: REPLACEMENT_MESSAGES.off })
    expect(api.signIn).not.toHaveBeenCalled()
  })

  it('confirms with the password and the current code (or a backup code), and refuses wrong ones', async () => {
    const { replacement, api } = await setup()
    expect(await replacement.confirm({ method: 'authenticator', password: 'wrong', code: '123456' })).toMatchObject({ status: 'error', field: 'password' })
    expect(await replacement.confirm({ method: 'authenticator', password: PASSWORD, code: '000000' })).toMatchObject({ status: 'error', field: 'code' })
    expect(await replacement.confirm({ method: 'backup_code', password: PASSWORD, code: 'ZZZZZ99999' })).toMatchObject({ status: 'error', field: 'code' })
    expect(await replacement.confirm({ method: 'backup_code', password: PASSWORD, code: 'ABCDE-23456' })).toMatchObject({ status: 'confirmed' })
    expect(await replacement.confirm({ method: 'authenticator', password: PASSWORD, code: '123456' })).toMatchObject({ status: 'confirmed' })
    // The check's own sign-in is never left behind.
    expect(api.revokeToken).toHaveBeenCalledWith('check-refresh')
  })

  it('needs a pass for this member and session that has not expired', async () => {
    let clock = 1_000_000
    const { person, current, replacement, api } = await setup({ now: () => clock })
    const confirmed = await replacement.confirm({ method: 'authenticator', password: PASSWORD, code: '123456' })
    if (confirmed.status !== 'confirmed') throw new Error('expected a pass')
    expect(verifyReplacementPass(key, confirmed.pass, { profileId: person.id, sessionId: current, now: clock })).toBe(true)
    expect(verifyReplacementPass(key, confirmed.pass, { profileId: person.id, sessionId: 'another-session', now: clock })).toBe(false)
    // Change the last character to a different one (a random pass can already end in '0').
    const tampered = `${confirmed.pass.slice(0, -1)}${confirmed.pass.endsWith('0') ? '1' : '0'}`
    expect(tampered).not.toBe(confirmed.pass)
    expect(verifyReplacementPass(key, tampered, { profileId: person.id, sessionId: current, now: clock })).toBe(false)
    expect(await replacement.start(issueReplacementPass(randomBytes(32), { profileId: person.id, sessionId: current, expiresAt: clock + 60_000 }))).toEqual({ status: 'error', error: REPLACEMENT_MESSAGES.passExpired })
    clock += 11 * 60_000
    expect(await replacement.start(confirmed.pass)).toEqual({ status: 'error', error: REPLACEMENT_MESSAGES.passExpired })
    expect(api.associateSoftwareToken).not.toHaveBeenCalled()
  })

  it('starts the new app, then a code from it replaces the old one, signs out other devices, audits and emails', async () => {
    const { person, current, other, replacement, api, notices } = await setup()
    const confirmed = await replacement.confirm({ method: 'authenticator', password: PASSWORD, code: '123456' })
    if (confirmed.status !== 'confirmed') throw new Error('expected a pass')
    expect(await replacement.start(confirmed.pass)).toMatchObject({ status: 'ready', secret: 'NEWSECRETKEY', qrDataUrl: 'data:image/png;base64,QR' })
    expect(await replacement.finish(confirmed.pass, '111111')).toEqual({ status: 'error', error: REPLACEMENT_MESSAGES.wrongNewCode })
    expect(await replacement.finish(confirmed.pass, '654321')).toEqual({ status: 'replaced', message: REPLACEMENT_MESSAGES.replaced })
    expect(api.setSoftwareTokenMfaPreference).toHaveBeenCalledWith({ accessToken: 'session-access', enabled: true })
    expect(await run(`select id::text as id from public.auth_sessions where profile_id = $1 and revoked_at is null`, [person.id])).toEqual([{ id: current }])
    expect(await run(`select revoke_reason from public.auth_sessions where id = $1`, [other])).toEqual([{ revoke_reason: 'mfa_reset' }])
    expect(await run(`select 1 from public.audit_events where action = 'account.mfa_replaced' and actor_id = $1`, [person.id])).toHaveLength(1)
    expect(notices).toEqual([expect.objectContaining({ to: 'admin@placeholder.example' })])
  })
})

describe('backup-code reminder', () => {
  it('reminds only when there are no unused backup codes', async () => {
    const person = await member('Placeholder Admin', { admin: true })
    const needsBackupCodes = createBackupCodeReminder(run)
    expect(await needsBackupCodes(person.id)).toBe(true)
    await createBackupCodeRepository({ query: run }).replaceBatch(person.id, key)
    expect(await needsBackupCodes(person.id)).toBe(false)
    expect(await createBackupCodeReminder(async () => { throw new Error('database unavailable') })(person.id)).toBe(false)
  })
})

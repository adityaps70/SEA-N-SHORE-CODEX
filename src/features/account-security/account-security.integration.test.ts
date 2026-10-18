import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import type { CognitoPrincipal } from '@/lib/auth/cognito-api'
import { createAwsAuthQueries } from '@/features/auth/aws-queries'
import { recordAccountSecurityAudit } from './audit'
import { createBackupCodeRepository, normalizeBackupCode } from './backup-codes'
import { createEmailChange, UPDATE_IDENTITY_EMAIL_SQL } from './email-change'
import { maskEmail } from './email-mask'
import { createPasswordChange } from './password-change'
import { ACCOUNT_SECURITY_LIMITS, consumeAccountSecurityAttempt } from './rate-limit'
import { createAccountSecurityEmailRepository, createAccountSecurityEmailWorker, queueEmailChangedNotice } from './security-emails'
import { createSessionControls } from './session-controls'
import { createSessionGuard } from './session-guard'
import { createSessionRepository } from './session-repository'
import type { AccountQuery } from './types'

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }))

/**
 * Round H (H3) against the real schema (PGlite with every migration, including 0088): sessions, per-device and
 * "all other devices" sign-out, the revoked-session check in the verified-user resolver, password change, email
 * change, backup codes, rate limits and the notice queue. Cognito is a stub; placeholder data only.
 */
let db: TestDatabase
let sequence = 0
const query: AccountQuery = (text, values) => db.query(text, values) as Promise<Array<Record<string, unknown>>>
const transaction = <T,>(work: (run: AccountQuery) => Promise<T>) => db.transaction((tx) => work(tx as AccountQuery))
const KEY = Buffer.alloc(32, 7)
const context = () => ({ userAgentSummary: 'Chrome on Windows', city: 'Mumbai', country: 'IN', ip: '203.0.113.9' })

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

/** A JWT-shaped access token carrying only what the session check reads (origin_jti and scope). */
function accessToken(originJti: string, scope = 'aws.cognito.signin.user.admin') {
  const payload = Buffer.from(JSON.stringify({ origin_jti: originJti, scope })).toString('base64url')
  return `eyJhbGciOiJub25lIn0.${payload}.signature`
}

async function member(email = `placeholder-${sequence + 1}@example.com`) {
  sequence += 1
  const rows = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [`Placeholder Member ${sequence}`])
  const id = String(rows[0]!.id)
  const sub = `placeholder-sub-${sequence}`
  await db.query(
    `insert into public.identity_accounts (profile_id, provider, provider_subject, provider_username, email, email_verified) values ($1, 'cognito', $2, $2, $3, true)`,
    [id, sub, email],
  )
  return { id, sub, email }
}

function sessionStack() {
  const repository = createSessionRepository({ query })
  const guard = createSessionGuard({ repository })
  const controls = createSessionControls({ repository, guard })
  return { repository, guard, controls }
}

async function signIn(guard: ReturnType<typeof createSessionGuard>, profileId: string, originJti: string) {
  const token = accessToken(originJti)
  const check = await guard.check({ accessToken: token, profileId, context })
  if (check.status !== 'active') throw new Error('expected an active session')
  return { token, sessionId: check.sessionId }
}

describe('sessions (auth_sessions)', () => {
  it('creates one row per sign-in on first sight, with the device summary, approximate location and a hashed IP only', async () => {
    const { id } = await member()
    const guard = createSessionGuard({ repository: createSessionRepository({ query }), hashIp: (ip) => (ip ? 'a'.repeat(32) : null) })
    const first = await signIn(guard, id, '0f1e2d3c-0000-4000-8000-000000000001')
    const again = await guard.check({ accessToken: first.token, profileId: id, context })
    expect(again).toEqual({ status: 'active', sessionId: first.sessionId })

    const rows = await db.query(`select * from public.auth_sessions where profile_id = $1`, [id])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ user_agent_summary: 'Chrome on Windows', approx_city: 'Mumbai', approx_country: 'IN', ip_hash: 'a'.repeat(32), sign_in_method: 'password', revoked_at: null })
    expect(JSON.stringify(rows[0])).not.toContain('203.0.113.9')
    expect(JSON.stringify(rows[0])).not.toContain('0f1e2d3c-0000-4000-8000-000000000001')
  })

  it('"Sign out of all other devices" keeps the current session and refuses the others', async () => {
    const { id } = await member()
    const { guard, controls, repository } = sessionStack()
    const current = await signIn(guard, id, 'aaaaaaaa-0000-4000-8000-000000000001')
    const laptop = await signIn(guard, id, 'aaaaaaaa-0000-4000-8000-000000000002')
    const phone = await signIn(guard, id, 'aaaaaaaa-0000-4000-8000-000000000003')

    await expect(controls.signOutOtherSessions(id, current.sessionId, 'signed_out_other_devices')).resolves.toBe(2)

    expect((await repository.listActive(id)).map((session) => session.id)).toEqual([current.sessionId])
    await expect(guard.check({ accessToken: current.token, profileId: id, context })).resolves.toEqual({ status: 'active', sessionId: current.sessionId })
    await expect(guard.check({ accessToken: laptop.token, profileId: id, context })).resolves.toEqual({ status: 'revoked', sessionId: laptop.sessionId })
    await expect(guard.check({ accessToken: phone.token, profileId: id, context })).resolves.toEqual({ status: 'revoked', sessionId: phone.sessionId })
    // Another server (its own cache) sees the revocation from the database.
    const otherServer = createSessionGuard({ repository: createSessionRepository({ query }) })
    await expect(otherServer.check({ accessToken: laptop.token, profileId: id, context })).resolves.toMatchObject({ status: 'revoked' })
  })

  it('signs out one device only, and never another member\'s session', async () => {
    const owner = await member()
    const stranger = await member()
    const { guard, controls } = sessionStack()
    const ownerPhone = await signIn(guard, owner.id, 'bbbbbbbb-0000-4000-8000-000000000001')
    const ownerLaptop = await signIn(guard, owner.id, 'bbbbbbbb-0000-4000-8000-000000000002')

    await expect(controls.signOutSession(stranger.id, ownerPhone.sessionId)).resolves.toBe(false)
    await expect(controls.signOutSession(owner.id, ownerPhone.sessionId)).resolves.toBe(true)
    await expect(controls.signOutSession(owner.id, ownerPhone.sessionId)).resolves.toBe(false)

    await expect(guard.check({ accessToken: ownerPhone.token, profileId: owner.id, context })).resolves.toMatchObject({ status: 'revoked' })
    await expect(guard.check({ accessToken: ownerLaptop.token, profileId: owner.id, context })).resolves.toMatchObject({ status: 'active' })
    const revoked = await db.query(`select revoke_reason from public.auth_sessions where id = $1`, [ownerPhone.sessionId])
    expect(revoked[0]?.revoke_reason).toBe('signed_out_remotely')
  })

  it('a revoked session is refused by the verified-user check (every page, action and API), even with valid Cognito tokens', async () => {
    const { id, sub, email } = await member()
    const { guard, controls } = sessionStack()
    const principal: CognitoPrincipal = { sub, email, emailVerified: true, name: 'Placeholder Member' }
    let token = accessToken('cccccccc-0000-4000-8000-000000000001')
    const queries = createAwsAuthQueries({
      getPrincipal: async () => principal,
      resolveProfileId: async () => id,
      provisionProfileId: async () => id,
      getProfileAccountStatus: async () => 'active',
      checkSession: (profileId) => guard.check({ accessToken: token, profileId, context }),
    })

    await expect(queries.getAwsVerifiedUser()).resolves.toMatchObject({ id })
    const [row] = await db.query(`select id from public.auth_sessions where profile_id = $1`, [id])
    await controls.signOutSession(id, String(row!.id))

    await expect(queries.getAwsVerifiedUser()).resolves.toBeNull()
    await expect(queries.getAwsVerification()).resolves.toEqual({ user: null, sessionRevoked: true })
    await expect(queries.requireAwsUser()).rejects.toThrow('Authentication required.')

    // A new sign-in on that device is a new session and works again.
    token = accessToken('cccccccc-0000-4000-8000-000000000002')
    await expect(queries.getAwsVerifiedUser()).resolves.toMatchObject({ id })
  })
})

describe('change password', () => {
  it('a password change ends every other session and keeps this one', async () => {
    const { id } = await member()
    const { guard, controls } = sessionStack()
    const current = await signIn(guard, id, 'dddddddd-0000-4000-8000-000000000001')
    const other = await signIn(guard, id, 'dddddddd-0000-4000-8000-000000000002')
    const changePasswordInCognito = vi.fn(async () => undefined)

    const changePassword = createPasswordChange({
      changePassword: changePasswordInCognito,
      getAccessToken: async () => current.token,
      getAccountKind: async () => 'eligible',
      allowAttempt: () => transaction((run) => consumeAccountSecurityAttempt(run, id, 'password_change')),
      signOutOtherSessions: () => controls.signOutOtherSessions(id, current.sessionId, 'password_changed'),
      audit: (signedOut) => recordAccountSecurityAudit(query, id, 'account.password_changed', { otherSessionsSignedOut: signedOut }),
    })
    const form = new FormData()
    form.set('currentPassword', 'OldPlaceholder1')
    form.set('newPassword', 'NewPlaceholder22')
    form.set('newPasswordConfirmation', 'NewPlaceholder22')

    await expect(changePassword({ status: 'idle' }, form)).resolves.toEqual({
      status: 'changed',
      message: 'Password changed. We signed you out of 1 other device.',
      signedOut: 1,
    })
    expect(changePasswordInCognito).toHaveBeenCalledWith({ accessToken: current.token, previousPassword: 'OldPlaceholder1', proposedPassword: 'NewPlaceholder22' })
    await expect(guard.check({ accessToken: current.token, profileId: id, context })).resolves.toMatchObject({ status: 'active' })
    await expect(guard.check({ accessToken: other.token, profileId: id, context })).resolves.toMatchObject({ status: 'revoked' })
    const reasons = await db.query(`select revoke_reason from public.auth_sessions where profile_id = $1 and revoked_at is not null`, [id])
    expect(reasons.map((row) => row.revoke_reason)).toEqual(['password_changed'])
    const audit = await db.query(`select action, metadata from public.audit_events where actor_id = $1`, [id])
    expect(audit).toEqual([{ action: 'account.password_changed', metadata: { otherSessionsSignedOut: 1 } }])
  })
})

describe('change email', () => {
  it('needs the code: the email does not change before verification, and the old address is told after', async () => {
    const oldEmail = 'old-placeholder@example.com'
    const newEmail = 'new-placeholder@example.com'
    const { id, sub } = await member(oldEmail)
    let cognitoEmail = oldEmail
    const pending: { email: string | null } = { email: null }
    const flows = createEmailChange({
      getAccessToken: async () => 'placeholder-access-token',
      getAccountState: async () => ({ kind: 'eligible', email: cognitoEmail }),
      // Like the user pool: the new address only becomes the email once its code is verified.
      requestEmailChange: async ({ email }) => { pending.email = email },
      verifyEmailChange: async ({ code }) => {
        if (code !== '123456' || !pending.email) throw Object.assign(new Error('mismatch'), { name: 'CognitoApiError' })
        cognitoEmail = pending.email
      },
      isDisposableEmail: () => false,
      allowAttempt: (action) => transaction((run) => consumeAccountSecurityAttempt(run, id, action)),
      recordChange: ({ oldEmail: previous, newEmail: next }) => transaction(async (run) => {
        await run(UPDATE_IDENTITY_EMAIL_SQL, [id, sub, next])
        if (previous) await queueEmailChangedNotice(run, { profileId: id, oldEmail: previous, maskedNewEmail: maskEmail(next) })
        await recordAccountSecurityAudit(run, id, 'account.email_changed')
      }),
    })

    const request = new FormData()
    request.set('email', newEmail)
    await expect(flows.requestEmailChange({ status: 'idle' }, request)).resolves.toMatchObject({ status: 'code-sent', pendingEmail: newEmail })

    const identityEmail = async () => (await db.query(`select email from public.identity_accounts where profile_id = $1`, [id]))[0]?.email
    expect(await identityEmail()).toBe(oldEmail)
    expect(await db.query(`select 1 from public.account_security_emails where profile_id = $1`, [id])).toHaveLength(0)

    const wrong = new FormData()
    wrong.set('code', '000000')
    wrong.set('pendingEmail', newEmail)
    await expect(flows.confirmEmailChange({ status: 'idle' }, wrong)).resolves.toMatchObject({ status: 'error' })
    expect(await identityEmail()).toBe(oldEmail)

    const right = new FormData()
    right.set('code', '123456')
    right.set('pendingEmail', newEmail)
    await expect(flows.confirmEmailChange({ status: 'idle' }, right)).resolves.toMatchObject({ status: 'changed', email: newEmail })
    expect(await identityEmail()).toBe(newEmail)

    const notices = await db.query(`select kind, recipient_email, payload from public.account_security_emails where profile_id = $1`, [id])
    expect(notices).toEqual([{ kind: 'email_changed', recipient_email: oldEmail, payload: { maskedNewEmail: 'n***@example.com' } }])
    const audit = await db.query(`select action, metadata from public.audit_events where actor_id = $1`, [id])
    expect(audit).toEqual([{ action: 'account.email_changed', metadata: {} }])
  })

  it('sends the notice to the old address through the worker and then forgets the address', async () => {
    const { id } = await member('notice-old@example.com')
    await queueEmailChangedNotice(query, { profileId: id, oldEmail: 'notice-old@example.com', maskedNewEmail: 'n***@example.com' })
    const sendEmail = vi.fn<(input: { to: string; text: string; subject: string }) => Promise<{ messageId: string }>>(async () => ({ messageId: 'placeholder-message' }))
    const worker = createAccountSecurityEmailWorker({
      repository: createAccountSecurityEmailRepository({ query, transaction }),
      resend: { sendEmail } as never,
      siteUrl: 'https://seanshore.example',
    })

    const result = await worker.runSweep(10)
    // The notice queued by the previous test goes out in the same sweep.
    expect(result).toMatchObject({ failed: 0, retrying: 0 })
    expect(result.sent).toBeGreaterThanOrEqual(1)
    const email = sendEmail.mock.calls.find(([input]) => input.to === 'notice-old@example.com')?.[0]
    expect(email?.text).toContain('Your Sea N Shore email was changed to n***@example.com.')
    expect(email?.text).toContain('contact support')
    const rows = await db.query(`select status, recipient_email from public.account_security_emails where profile_id = $1`, [id])
    expect(rows).toEqual([{ status: 'sent', recipient_email: null }])
  })
})

describe('2FA backup codes (mfa_backup_codes)', () => {
  it('stores only salted hashes, and a code works once (the second use is refused)', async () => {
    const { id } = await member()
    const codes = createBackupCodeRepository({ query })
    const batch = await transaction((run) => createBackupCodeRepository({ query: run }).replaceBatch(id, KEY))
    expect(batch.codes).toHaveLength(10)
    expect(batch.replaced).toBe(false)

    const stored = await db.query(`select code_hash, code_salt, batch_id from public.mfa_backup_codes where profile_id = $1`, [id])
    expect(stored).toHaveLength(10)
    expect(new Set(stored.map((row) => row.batch_id)).size).toBe(1)
    for (const code of batch.codes) expect(JSON.stringify(stored)).not.toContain(normalizeBackupCode(code)!)

    const code = normalizeBackupCode(batch.codes[3])!
    await expect(codes.consume(id, KEY, code)).resolves.toBe(true)
    await expect(codes.consume(id, KEY, code)).resolves.toBe(false)
    await expect(codes.status(id)).resolves.toMatchObject({ remaining: 9 })
  })

  it('two simultaneous uses of one code: only one succeeds', async () => {
    const { id } = await member()
    const codes = createBackupCodeRepository({ query })
    const batch = await codes.replaceBatch(id, KEY)
    const code = normalizeBackupCode(batch.codes[0])!
    const results = await Promise.all([codes.consume(id, KEY, code), codes.consume(id, KEY, code)])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  it('regenerating invalidates the previous batch', async () => {
    const { id } = await member()
    const codes = createBackupCodeRepository({ query })
    const first = await codes.replaceBatch(id, KEY)
    const second = await codes.replaceBatch(id, KEY)
    expect(second.replaced).toBe(true)

    for (const code of first.codes) {
      if (second.codes.includes(code)) continue
      await expect(codes.consume(id, KEY, normalizeBackupCode(code)!)).resolves.toBe(false)
    }
    await expect(codes.consume(id, KEY, normalizeBackupCode(second.codes[0])!)).resolves.toBe(true)
    // Another member's code never works for this member, and a different key matches nothing.
    const other = await member()
    const otherBatch = await codes.replaceBatch(other.id, KEY)
    await expect(codes.consume(id, KEY, normalizeBackupCode(otherBatch.codes[0])!)).resolves.toBe(false)
    await expect(codes.consume(other.id, Buffer.alloc(32, 9), normalizeBackupCode(otherBatch.codes[0])!)).resolves.toBe(false)
  })
})

describe('rate limits (account_security_attempts)', () => {
  it('refuses an action once the member reaches its limit, per member and per action', async () => {
    const { id } = await member()
    const { id: otherId } = await member()
    const limit = ACCOUNT_SECURITY_LIMITS.backup_code_sign_in.max
    for (let attempt = 0; attempt < limit; attempt += 1) {
      await expect(transaction((run) => consumeAccountSecurityAttempt(run, id, 'backup_code_sign_in'))).resolves.toBe(true)
    }
    await expect(transaction((run) => consumeAccountSecurityAttempt(run, id, 'backup_code_sign_in'))).resolves.toBe(false)
    await expect(transaction((run) => consumeAccountSecurityAttempt(run, id, 'password_change'))).resolves.toBe(true)
    await expect(transaction((run) => consumeAccountSecurityAttempt(run, otherId, 'backup_code_sign_in'))).resolves.toBe(true)
  })
})

import { describe, expect, it, vi } from 'vitest'
import { satisfiesAdminMfa } from '@/features/auth/mfa'
import { BACKUP_CODE_MESSAGES, BACKUP_SIGN_IN_MESSAGES, createBackupCodeGeneration, createBackupCodeSignIn } from './backup-code-flows'
import { BACKUP_CODE_ALPHABET, formatBackupCode, generateBackupCode, hashBackupCode, normalizeBackupCode } from './backup-codes'
import { deriveAccountSecurityKey } from './keys'
import { signMfaChallenge, verifyMfaChallengeBinding } from './mfa-challenge-binding'

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const KEY = deriveAccountSecurityKey('placeholder-server-secret-with-at-least-32-chars', 'mfa-backup-codes')!
const BINDING_KEY = deriveAccountSecurityKey('placeholder-server-secret-with-at-least-32-chars', 'mfa-challenge-binding')!

describe('backup code format and hashing (Round H, H3)', () => {
  it('makes 10-character codes from an alphabet without look-alikes, shown as XXXXX-XXXXX', () => {
    for (const character of '01ILO') expect(BACKUP_CODE_ALPHABET).not.toContain(character)
    const code = generateBackupCode()
    expect(code).toMatch(new RegExp(`^[${BACKUP_CODE_ALPHABET}]{10}$`))
    expect(formatBackupCode('ABCDE23456')).toBe('ABCDE-23456')
    expect(normalizeBackupCode(' abcde-23456 ')).toBe('ABCDE23456')
    expect(normalizeBackupCode('ABCDE-2345O')).toBeNull()
    expect(normalizeBackupCode('ABCDE')).toBeNull()
  })

  it('hashes with a server key and a per-code salt, so equal codes never share a hash', () => {
    const a = hashBackupCode(KEY, '0'.repeat(32), 'ABCDE23456')
    expect(a).toMatch(/^[0-9a-f]{64}$/)
    expect(hashBackupCode(KEY, '1'.repeat(32), 'ABCDE23456')).not.toBe(a)
    expect(hashBackupCode(deriveAccountSecurityKey('another-placeholder-secret-of-32-chars!!', 'mfa-backup-codes')!, '0'.repeat(32), 'ABCDE23456')).not.toBe(a)
    expect(deriveAccountSecurityKey('short', 'mfa-backup-codes')).toBeNull()
    expect(deriveAccountSecurityKey('placeholder-server-secret-with-at-least-32-chars', 'session-ip')).not.toEqual(KEY)
  })
})

describe('generating backup codes', () => {
  function setup() {
    const deps = {
      getAccessToken: vi.fn(async (): Promise<string | null> => 'placeholder-access-token'),
      getMfaStatus: vi.fn(async () => ({ kind: 'eligible' as const, enabled: true, email: 'member@example.com', hostedSession: false })),
      verifyPassword: vi.fn(async ({ password }: { email: string; password: string }) => password === 'RightPlaceholder1'),
      hasKey: vi.fn(() => true),
      allowAttempt: vi.fn(async () => true),
      replaceBatch: vi.fn(async () => ({ codes: ['ABCDE-23456'], replaced: true })),
    }
    return { deps, generate: createBackupCodeGeneration(deps) }
  }

  it('needs the authenticator app on and the current password, then shows the codes once', async () => {
    const { deps, generate } = setup()
    await expect(generate({ status: 'idle' }, form({ currentPassword: 'RightPlaceholder1' }))).resolves.toEqual({ status: 'ready', codes: ['ABCDE-23456'], regenerated: true })
    expect(deps.verifyPassword).toHaveBeenCalledWith({ email: 'member@example.com', password: 'RightPlaceholder1' })

    await expect(generate({ status: 'idle' }, form({ currentPassword: 'WrongPlaceholder1' }))).resolves.toMatchObject({ error: BACKUP_CODE_MESSAGES.wrongPassword, field: 'currentPassword' })
    deps.getMfaStatus.mockResolvedValueOnce({ kind: 'eligible', enabled: false, email: 'member@example.com', hostedSession: false })
    await expect(generate({ status: 'idle' }, form({ currentPassword: 'RightPlaceholder1' }))).resolves.toMatchObject({ error: BACKUP_CODE_MESSAGES.needsAuthenticator })
    deps.getMfaStatus.mockResolvedValueOnce({ kind: 'federated' as never, enabled: false, email: 'member@example.com', hostedSession: true })
    await expect(generate({ status: 'idle' }, form({ currentPassword: 'RightPlaceholder1' }))).resolves.toMatchObject({ error: BACKUP_CODE_MESSAGES.needsAuthenticator })
    deps.allowAttempt.mockResolvedValueOnce(false)
    await expect(generate({ status: 'idle' }, form({ currentPassword: 'RightPlaceholder1' }))).resolves.toMatchObject({ error: BACKUP_CODE_MESSAGES.tooMany })
    deps.hasKey.mockReturnValueOnce(false)
    await expect(generate({ status: 'idle' }, form({ currentPassword: 'RightPlaceholder1' }))).resolves.toMatchObject({ error: BACKUP_CODE_MESSAGES.unavailable })
    await expect(generate({ status: 'idle' }, form({}))).resolves.toMatchObject({ field: 'currentPassword' })
    expect(deps.replaceBatch).toHaveBeenCalledTimes(1)
  })
})

describe('signing in with a backup code', () => {
  const session = 'opaque-mfa-session'
  const username = 'internal-user-1'

  function setup(binding = signMfaChallenge(BINDING_KEY, { session, username })) {
    const deps = {
      readChallenge: vi.fn(() => ({ session, username, binding })),
      verifyBinding: vi.fn((challenge: { session: string; username: string; binding: string | null }) => verifyMfaChallengeBinding(BINDING_KEY, challenge)),
      resolveProfileId: vi.fn(async () => '11111111-1111-4111-8111-111111111111'),
      allowAttempt: vi.fn(async () => true),
      useCodeAndReset: vi.fn(async ({ code }: { profileId: string; username: string; code: string }) => (code === 'ABCDE23456' ? 'reset' as const : 'no_match' as const)),
      clearChallenge: vi.fn(),
    }
    return { deps, signIn: createBackupCodeSignIn(deps) }
  }

  it('resets 2FA for the member whose password step just succeeded, then asks for a fresh sign-in', async () => {
    const { deps, signIn } = setup()
    await expect(signIn({}, form({ code: 'abcde-23456' }))).resolves.toEqual({ reset: true })
    expect(deps.useCodeAndReset).toHaveBeenCalledWith({ profileId: '11111111-1111-4111-8111-111111111111', username, code: 'ABCDE23456' })
    expect(deps.clearChallenge).toHaveBeenCalled()
  })

  it('a wrong code keeps the challenge so the member can try another; too many attempts end it', async () => {
    const { deps, signIn } = setup()
    await expect(signIn({}, form({ code: 'ZZZZZ-ZZZZZ' }))).resolves.toEqual({ error: BACKUP_SIGN_IN_MESSAGES.wrongCode })
    expect(deps.clearChallenge).not.toHaveBeenCalled()
    deps.allowAttempt.mockResolvedValueOnce(false)
    await expect(signIn({}, form({ code: 'ABCDE-23456' }))).resolves.toEqual({ error: BACKUP_SIGN_IN_MESSAGES.tooMany })
    expect(deps.clearChallenge).toHaveBeenCalled()
    expect(deps.useCodeAndReset).toHaveBeenCalledTimes(1)
  })

  it('is tied to the sign-in in progress: a forged or missing challenge signature checks no code', async () => {
    for (const binding of [null, 'f'.repeat(64), signMfaChallenge(BINDING_KEY, { session, username: 'someone-else' })]) {
      const { deps, signIn } = setup(binding)
      await expect(signIn({}, form({ code: 'ABCDE-23456' }))).resolves.toEqual({ error: BACKUP_SIGN_IN_MESSAGES.expired })
      expect(deps.resolveProfileId).not.toHaveBeenCalled()
      expect(deps.useCodeAndReset).not.toHaveBeenCalled()
    }
    const { deps, signIn } = setup()
    deps.readChallenge.mockReturnValueOnce(null as never)
    await expect(signIn({}, form({ code: 'ABCDE-23456' }))).resolves.toEqual({ error: BACKUP_SIGN_IN_MESSAGES.expired })
    await expect(signIn({}, form({ code: 'nope' }))).resolves.toEqual({ error: BACKUP_SIGN_IN_MESSAGES.invalidCode })
  })

  it('after a reset an administrator no longer passes the admin MFA gate until the app is set up again', () => {
    expect(satisfiesAdminMfa({ kind: 'eligible', enabled: false, email: 'admin@example.com', hostedSession: false })).toBe(false)
    expect(satisfiesAdminMfa({ kind: 'eligible', enabled: true, email: 'admin@example.com', hostedSession: false })).toBe(true)
  })
})

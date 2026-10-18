import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import { createPasswordChange, PASSWORD_CHANGE_MESSAGES } from './password-change'

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

const valid = { currentPassword: 'OldPlaceholder1', newPassword: 'NewPlaceholder22', newPasswordConfirmation: 'NewPlaceholder22' }

function setup() {
  const deps = {
    changePassword: vi.fn(async () => undefined),
    getAccessToken: vi.fn(async (): Promise<string | null> => 'placeholder-access-token'),
    getAccountKind: vi.fn(async () => 'eligible' as const),
    allowAttempt: vi.fn(async () => true),
    signOutOtherSessions: vi.fn(async () => 2),
    audit: vi.fn(async () => undefined),
  }
  return { deps, changePassword: createPasswordChange(deps) }
}

describe('change password (Round H, H3; Cognito mocked)', () => {
  it('changes the password with the member\'s access token and signs out the other sessions only after Cognito accepts it', async () => {
    const { deps, changePassword } = setup()
    await expect(changePassword({ status: 'idle' }, form(valid))).resolves.toEqual({
      status: 'changed',
      message: 'Password changed. We signed you out of 2 other devices.',
      signedOut: 2,
    })
    expect(deps.changePassword).toHaveBeenCalledWith({ accessToken: 'placeholder-access-token', previousPassword: 'OldPlaceholder1', proposedPassword: 'NewPlaceholder22' })
    expect(deps.changePassword.mock.invocationCallOrder[0]).toBeLessThan(deps.signOutOtherSessions.mock.invocationCallOrder[0]!)
    expect(deps.audit).toHaveBeenCalledWith(2)
  })

  it('applies the sign-up strength rules and checks the confirmation before calling Cognito', async () => {
    const { deps, changePassword } = setup()
    await expect(changePassword({ status: 'idle' }, form({ ...valid, newPassword: 'short', newPasswordConfirmation: 'short' })))
      .resolves.toMatchObject({ status: 'error', field: 'newPassword', error: expect.stringContaining('at least 12 characters') })
    await expect(changePassword({ status: 'idle' }, form({ ...valid, newPassword: 'alllowercase123', newPasswordConfirmation: 'alllowercase123' })))
      .resolves.toMatchObject({ status: 'error', field: 'newPassword', error: 'Your password needs an uppercase letter.' })
    await expect(changePassword({ status: 'idle' }, form({ ...valid, newPasswordConfirmation: 'NewPlaceholder23' })))
      .resolves.toMatchObject({ status: 'error', field: 'newPasswordConfirmation', error: PASSWORD_CHANGE_MESSAGES.confirmMismatch })
    await expect(changePassword({ status: 'idle' }, form({ ...valid, currentPassword: '' })))
      .resolves.toMatchObject({ status: 'error', field: 'currentPassword' })
    await expect(changePassword({ status: 'idle' }, form({ ...valid, currentPassword: 'NewPlaceholder22' })))
      .resolves.toMatchObject({ status: 'error', error: PASSWORD_CHANGE_MESSAGES.sameAsCurrent })
    expect(deps.changePassword).not.toHaveBeenCalled()
    expect(deps.signOutOtherSessions).not.toHaveBeenCalled()
  })

  it('signs nobody out when the current password is wrong, and tells an expired session apart', async () => {
    const { deps, changePassword } = setup()
    deps.changePassword.mockRejectedValueOnce(new CognitoApiError('NotAuthorizedException'))
    await expect(changePassword({ status: 'idle' }, form(valid))).resolves.toEqual({ status: 'error', error: PASSWORD_CHANGE_MESSAGES.wrongCurrent, field: 'currentPassword' })

    deps.changePassword.mockRejectedValueOnce(new CognitoApiError('NotAuthorizedException', undefined, 'token'))
    await expect(changePassword({ status: 'idle' }, form(valid))).resolves.toEqual({ status: 'error', error: PASSWORD_CHANGE_MESSAGES.sessionExpired })

    deps.changePassword.mockRejectedValueOnce(new CognitoApiError('LimitExceededException'))
    await expect(changePassword({ status: 'idle' }, form(valid))).resolves.toMatchObject({ error: PASSWORD_CHANGE_MESSAGES.tooMany })
    expect(deps.signOutOtherSessions).not.toHaveBeenCalled()
  })

  it('is refused for Google-only accounts, over the rate limit, and without a session', async () => {
    const { deps, changePassword } = setup()
    deps.getAccountKind.mockResolvedValueOnce('federated' as never)
    await expect(changePassword({ status: 'idle' }, form(valid))).resolves.toMatchObject({ error: PASSWORD_CHANGE_MESSAGES.federated })
    deps.allowAttempt.mockResolvedValueOnce(false)
    await expect(changePassword({ status: 'idle' }, form(valid))).resolves.toMatchObject({ error: PASSWORD_CHANGE_MESSAGES.tooMany })
    deps.getAccessToken.mockResolvedValueOnce(null)
    await expect(changePassword({ status: 'idle' }, form(valid))).resolves.toMatchObject({ error: PASSWORD_CHANGE_MESSAGES.sessionExpired })
    expect(deps.changePassword).not.toHaveBeenCalled()
  })

  it('says so when the password changed but the other devices could not be signed out', async () => {
    const { deps, changePassword } = setup()
    vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    deps.signOutOtherSessions.mockRejectedValueOnce(new Error('database unavailable'))
    await expect(changePassword({ status: 'idle' }, form(valid))).resolves.toEqual({ status: 'changed', message: PASSWORD_CHANGE_MESSAGES.othersNotSignedOut, signedOut: 0 })
  })
})

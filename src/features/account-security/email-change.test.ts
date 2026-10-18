import { describe, expect, it, vi } from 'vitest'
import { CognitoApiError } from '@/lib/auth/cognito-api'
import { DISPOSABLE_EMAIL_MESSAGE } from '@/lib/errors/user-messages'
import { createEmailChange, EMAIL_CHANGE_MESSAGES } from './email-change'
import { maskEmail } from './email-mask'

function form(values: Record<string, string>) {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}

function setup() {
  const cognito = { email: 'old-placeholder@example.com', pending: null as string | null }
  const deps = {
    getAccessToken: vi.fn(async (): Promise<string | null> => 'placeholder-access-token'),
    getAccountState: vi.fn(async () => ({ kind: 'eligible' as const, email: cognito.email })),
    requestEmailChange: vi.fn(async ({ email }: { email: string }) => { cognito.pending = email }),
    verifyEmailChange: vi.fn(async ({ code }: { code: string }) => {
      if (code !== '123456') throw new CognitoApiError('CodeMismatchException')
      if (cognito.pending) cognito.email = cognito.pending
    }),
    isDisposableEmail: vi.fn((email: string) => email.endsWith('@mailinator.com')),
    allowAttempt: vi.fn(async () => true),
    recordChange: vi.fn(async () => undefined),
  }
  return { cognito, deps, flows: createEmailChange(deps) }
}

describe('change email (Round H, H3; Cognito mocked)', () => {
  it('an email change needs verification: requesting it changes nothing; the code switches it and the old address is told', async () => {
    const { cognito, deps, flows } = setup()
    await expect(flows.requestEmailChange({ status: 'idle' }, form({ email: ' New-Placeholder@Example.com ' }))).resolves.toMatchObject({
      status: 'code-sent',
      pendingEmail: 'new-placeholder@example.com',
    })
    expect(deps.requestEmailChange).toHaveBeenCalledWith({ accessToken: 'placeholder-access-token', email: 'new-placeholder@example.com' })
    expect(cognito.email).toBe('old-placeholder@example.com')
    expect(deps.recordChange).not.toHaveBeenCalled()
    expect(deps.allowAttempt).toHaveBeenCalledWith('email_change_code')

    await expect(flows.confirmEmailChange({ status: 'idle' }, form({ code: '000000', pendingEmail: 'new-placeholder@example.com' }))).resolves.toMatchObject({
      status: 'error', field: 'code', error: EMAIL_CHANGE_MESSAGES.wrongCode, pendingEmail: 'new-placeholder@example.com',
    })
    expect(deps.recordChange).not.toHaveBeenCalled()

    await expect(flows.confirmEmailChange({ status: 'idle' }, form({ code: '123 456', pendingEmail: 'new-placeholder@example.com' }))).resolves.toMatchObject({
      status: 'changed', email: 'new-placeholder@example.com',
    })
    expect(deps.recordChange).toHaveBeenCalledWith({ oldEmail: 'old-placeholder@example.com', newEmail: 'new-placeholder@example.com' })
    expect(deps.allowAttempt).toHaveBeenCalledWith('email_change_verify')
  })

  it('records nothing when Cognito still holds the old address after the code (no change was waiting)', async () => {
    const { deps, flows } = setup()
    await expect(flows.confirmEmailChange({ status: 'idle' }, form({ code: '123456' }))).resolves.toMatchObject({ status: 'error', error: EMAIL_CHANGE_MESSAGES.nothingPending })
    expect(deps.recordChange).not.toHaveBeenCalled()
  })

  it('refuses invalid, unchanged and disposable addresses, Google-only accounts and too many code sends', async () => {
    const { deps, flows } = setup()
    await expect(flows.requestEmailChange({ status: 'idle' }, form({ email: 'not-an-email' }))).resolves.toMatchObject({ field: 'email', error: EMAIL_CHANGE_MESSAGES.invalidEmail })
    await expect(flows.requestEmailChange({ status: 'idle' }, form({ email: 'old-placeholder@example.com' }))).resolves.toMatchObject({ error: EMAIL_CHANGE_MESSAGES.sameEmail })
    await expect(flows.requestEmailChange({ status: 'idle' }, form({ email: 'someone@mailinator.com' }))).resolves.toMatchObject({ error: DISPOSABLE_EMAIL_MESSAGE })
    deps.getAccountState.mockResolvedValueOnce({ kind: 'federated' as never, email: 'old-placeholder@example.com' })
    await expect(flows.requestEmailChange({ status: 'idle' }, form({ email: 'new-placeholder@example.com' }))).resolves.toMatchObject({ error: EMAIL_CHANGE_MESSAGES.federated })
    deps.allowAttempt.mockResolvedValueOnce(false)
    await expect(flows.requestEmailChange({ status: 'idle' }, form({ email: 'new-placeholder@example.com' }))).resolves.toMatchObject({ error: EMAIL_CHANGE_MESSAGES.tooMany })
    expect(deps.requestEmailChange).not.toHaveBeenCalled()
  })

  it('maps Cognito refusals to plain messages', async () => {
    const { deps, flows } = setup()
    deps.requestEmailChange.mockRejectedValueOnce(new CognitoApiError('AliasExistsException'))
    await expect(flows.requestEmailChange({ status: 'idle' }, form({ email: 'taken-placeholder@example.com' }))).resolves.toMatchObject({ error: EMAIL_CHANGE_MESSAGES.unavailableEmail })
    deps.requestEmailChange.mockRejectedValueOnce(new CognitoApiError('NotAuthorizedException', undefined, 'token'))
    await expect(flows.requestEmailChange({ status: 'idle' }, form({ email: 'new-placeholder@example.com' }))).resolves.toMatchObject({ error: EMAIL_CHANGE_MESSAGES.sessionExpired })
    deps.verifyEmailChange.mockRejectedValueOnce(new CognitoApiError('ExpiredCodeException'))
    await expect(flows.confirmEmailChange({ status: 'idle' }, form({ code: '123456' }))).resolves.toMatchObject({ error: EMAIL_CHANGE_MESSAGES.expiredCode })
    await expect(flows.confirmEmailChange({ status: 'idle' }, form({ code: '12' }))).resolves.toMatchObject({ error: EMAIL_CHANGE_MESSAGES.invalidCode })
  })

  it('masks the new address in the notice to the old one', () => {
    expect(maskEmail('new-placeholder@example.com')).toBe('n***@example.com')
    expect(maskEmail(' N@Example.com ')).toBe('n***@example.com')
    expect(maskEmail('broken')).toBe('***')
  })
})

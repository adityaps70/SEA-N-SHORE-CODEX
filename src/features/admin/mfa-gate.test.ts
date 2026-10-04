import { describe, expect, it, vi } from 'vitest'
import type { CurrentMfaStatus } from '@/features/auth/mfa'

vi.mock('@/features/auth/mfa-status', () => ({ getCurrentMfaStatus: vi.fn() }))

import { createAdminMfaGate } from './mfa-gate'

const ready: CurrentMfaStatus = { kind: 'eligible', enabled: true, email: 'admin@example.com', hostedSession: false }

function gate(status: CurrentMfaStatus | null | Error, returnPath: string | null = '/admin/users') {
  const redirect = vi.fn((href: string) => {
    throw Object.assign(new Error('NEXT_REDIRECT'), { href })
  }) as unknown as ((href: string) => never) & ReturnType<typeof vi.fn>
  const getStatus = vi.fn(async () => {
    if (status instanceof Error) throw status
    return status
  })
  return { redirect, getStatus, enforce: createAdminMfaGate({ getStatus, getReturnPath: async () => returnPath, redirect }) }
}

describe('platform admin MFA gate (Round 14, 2.11)', () => {
  it('lets an administrator with an authenticator app and a password sign-in through', async () => {
    const { enforce, redirect } = gate(ready)
    await expect(enforce()).resolves.toBeUndefined()
    expect(redirect).not.toHaveBeenCalled()
  })

  it('sends an administrator without an authenticator app to setup, then back to the page', async () => {
    const { enforce, redirect } = gate({ ...ready, enabled: false })
    await expect(enforce()).rejects.toMatchObject({ message: 'NEXT_REDIRECT' })
    expect(redirect).toHaveBeenCalledWith('/settings/security?required=admin&next=%2Fadmin%2Fusers')
  })

  it.each([
    ['a Google sign-in on an account that has an app', { ...ready, hostedSession: true }],
    ['a Google-only account', { ...ready, kind: 'federated' as const }],
    ['a mobile sign-in account', { ...ready, kind: 'phone' as const, enabled: false }],
    ['no readable session', null],
  ])('redirects %s', async (_label, status) => {
    const { enforce, redirect } = gate(status)
    await expect(enforce()).rejects.toMatchObject({ message: 'NEXT_REDIRECT' })
    expect(redirect).toHaveBeenCalledTimes(1)
  })

  it('drops an unsafe return path', async () => {
    const { enforce, redirect } = gate({ ...ready, enabled: false }, 'https://evil.example')
    await expect(enforce()).rejects.toBeTruthy()
    expect(redirect).toHaveBeenCalledWith('/settings/security?required=admin')
  })

  it('fails closed when Cognito cannot be reached', async () => {
    const { enforce, redirect } = gate(new Error('TransportError'))
    await expect(enforce()).rejects.toThrow('TransportError')
    expect(redirect).not.toHaveBeenCalled()
  })
})

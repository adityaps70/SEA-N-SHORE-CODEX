import { describe, expect, it, vi } from 'vitest'
import type { CurrentMfaStatus } from '@/features/auth/mfa'

vi.mock('@/features/auth/mfa-status', () => ({ getCurrentMfaStatus: vi.fn() }))
vi.mock('./repository', () => ({ adminRepository: { isPlatformAdministrator: vi.fn() } }))

import { createAdminActionMfaChecks, createAdminMfaGate } from './mfa-gate'

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

describe('platform admin server-action MFA checks (Round 15)', () => {
  function checks(input: { admin: boolean | Error; status: CurrentMfaStatus | null | Error }) {
    const isPlatformAdministrator = vi.fn(async () => {
      if (input.admin instanceof Error) throw input.admin
      return input.admin
    })
    const getStatus = vi.fn(async () => {
      if (input.status instanceof Error) throw input.status
      return input.status
    })
    return { isPlatformAdministrator, getStatus, ...createAdminActionMfaChecks({ isPlatformAdministrator, getStatus }) }
  }

  it('lets an administrator whose session answered an authenticator app act', async () => {
    const gate = checks({ admin: true, status: ready })
    await expect(gate.adminActionMfaMissing('admin-1')).resolves.toBe(false)
    await expect(gate.canUsePlatformAdminAuthority('admin-1')).resolves.toBe(true)
    expect(gate.isPlatformAdministrator).toHaveBeenCalledWith('admin-1')
  })

  it.each([
    ['no authenticator app', { ...ready, enabled: false }],
    ['a Google sign-in on an account that has an app', { ...ready, hostedSession: true }],
    ['a Google-only account', { ...ready, kind: 'federated' as const }],
    ['no readable session', null],
    ['an unreachable Cognito', new Error('TransportError')],
  ])('refuses an administrator with %s', async (_label, status) => {
    const gate = checks({ admin: true, status })
    await expect(gate.adminActionMfaMissing('admin-1')).resolves.toBe(true)
    await expect(gate.canUsePlatformAdminAuthority('admin-1')).resolves.toBe(false)
  })

  it('leaves members who are not administrators alone and never grants them admin authority', async () => {
    const gate = checks({ admin: false, status: null })
    await expect(gate.adminActionMfaMissing('member-1')).resolves.toBe(false)
    await expect(gate.canUsePlatformAdminAuthority('member-1')).resolves.toBe(false)
    expect(gate.getStatus).not.toHaveBeenCalled()
  })

  it('fails closed when the administrator role cannot be read', async () => {
    const gate = checks({ admin: new Error('database down'), status: null })
    await expect(gate.adminActionMfaMissing('someone')).resolves.toBe(true)
    await expect(gate.canUsePlatformAdminAuthority('someone')).resolves.toBe(false)
  })
})

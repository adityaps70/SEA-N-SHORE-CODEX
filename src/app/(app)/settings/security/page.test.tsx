import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CurrentMfaStatus } from '@/features/auth/mfa'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  isPlatformAdministrator: vi.fn(),
  getCurrentMfaStatus: vi.fn(),
  startAuthenticatorSetup: vi.fn(),
  confirmAuthenticatorSetup: vi.fn(),
  disableAuthenticator: vi.fn(),
  signOut: vi.fn(async () => undefined),
  refresh: vi.fn(),
  replace: vi.fn(),
  hasAdminStepUp: vi.fn(async () => false),
  adminStepUpAction: vi.fn(async () => ({})),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }) }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/repository', () => ({ adminRepository: { isPlatformAdministrator: mocks.isPlatformAdministrator } }))
vi.mock('@/features/auth/mfa-status', () => ({ getCurrentMfaStatus: mocks.getCurrentMfaStatus }))
vi.mock('@/features/auth/actions', () => ({ signOut: mocks.signOut }))
vi.mock('@/features/account-security/admin-step-up-runtime', () => ({ hasAdminStepUp: mocks.hasAdminStepUp }))
vi.mock('@/features/account-security/admin-step-up-actions', () => ({ adminStepUpAction: mocks.adminStepUpAction }))
vi.mock('@/features/auth/mfa-actions', () => ({
  startAuthenticatorSetup: mocks.startAuthenticatorSetup,
  confirmAuthenticatorSetup: mocks.confirmAuthenticatorSetup,
  disableAuthenticator: mocks.disableAuthenticator,
}))

import SecuritySettingsPage from './page'

const off: CurrentMfaStatus = { kind: 'eligible', enabled: false, email: 'captain@example.com', hostedSession: false }
const on: CurrentMfaStatus = { ...off, enabled: true }

async function renderPage(params: Record<string, string> = {}) {
  return render(await SecuritySettingsPage({ searchParams: Promise.resolve(params) }))
}

afterEach(() => cleanup())

describe('/settings/security (Round 14, 2.11)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'profile-1' })
    mocks.isPlatformAdministrator.mockResolvedValue(false)
    mocks.getCurrentMfaStatus.mockResolvedValue(off)
  })

  it('renders as a Settings sub-page with the authenticator app off', async () => {
    await renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Two-step verification' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/settings')
    const panel = screen.getByRole('region', { name: /Authenticator app/ })
    expect(within(panel).getByText('Off')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Set up authenticator app' })).toBeEnabled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('sets up an authenticator app: QR code, manual key, then a verified code turns it on', async () => {
    mocks.startAuthenticatorSetup.mockResolvedValueOnce({
      status: 'ready',
      secret: 'JBSWY3DPEHPK3PXP',
      otpauthUri: 'otpauth://totp/Sea%20N%20Shore:captain%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=Sea%20N%20Shore',
      qrDataUrl: 'data:image/png;base64,QR',
    })
    mocks.confirmAuthenticatorSetup.mockResolvedValueOnce({ status: 'enabled', message: 'Authenticator app turned on.', redirectTo: null })
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Set up authenticator app' }))

    const qr = await screen.findByRole('img', { name: /QR code/ })
    expect(qr).toHaveAttribute('src', 'data:image/png;base64,QR')
    expect(screen.getByLabelText('Setup key')).toHaveTextContent('JBSW Y3DP EHPK 3PXP')
    fireEvent.change(screen.getByLabelText(/Enter the 6-digit code/), { target: { value: '123456' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Verify and turn on' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Authenticator app turned on.'))
    const submitted = mocks.confirmAuthenticatorSetup.mock.calls[0]?.[1] as FormData
    expect(submitted.get('code')).toBe('123456')
    expect(mocks.refresh).toHaveBeenCalled()
    expect(screen.queryByLabelText('Setup key')).not.toBeInTheDocument()
  })

  it('keeps the setup open and explains a wrong code', async () => {
    mocks.startAuthenticatorSetup.mockResolvedValueOnce({ status: 'ready', secret: 'ABCDEFGH', otpauthUri: 'otpauth://totp/x', qrDataUrl: 'data:image/png;base64,QR' })
    mocks.confirmAuthenticatorSetup.mockResolvedValueOnce({ status: 'error', error: 'That code didn’t match.' })
    await renderPage()

    fireEvent.click(screen.getByRole('button', { name: 'Set up authenticator app' }))
    fireEvent.change(await screen.findByLabelText(/Enter the 6-digit code/), { target: { value: '000000' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Verify and turn on' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('That code didn’t match.'))
    expect(screen.getByLabelText('Setup key')).toBeInTheDocument()
  })

  it('lets a member turn it off after confirming', async () => {
    mocks.getCurrentMfaStatus.mockResolvedValue(on)
    mocks.disableAuthenticator.mockResolvedValueOnce({ status: 'disabled', message: 'Authenticator app turned off.' })
    await renderPage()

    expect(screen.getByText('On')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(mocks.disableAuthenticator).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Authenticator app turned off.'))
    expect(mocks.disableAuthenticator).toHaveBeenCalledTimes(1)
  })

  it('never offers platform administrators a way to turn it off', async () => {
    mocks.getCurrentMfaStatus.mockResolvedValue(on)
    mocks.isPlatformAdministrator.mockResolvedValue(true)
    await renderPage()

    expect(screen.queryByRole('button', { name: 'Turn off' })).not.toBeInTheDocument()
    expect(screen.getByText(/Platform administrators must keep two-step verification on/)).toBeInTheDocument()
  })

  it.each([
    ['Google-only', { ...off, kind: 'federated' as const }, /You sign in with Google/],
    ['mobile sign-in', { ...off, kind: 'phone' as const }, /You signed in with a mobile number code/],
  ])('hides authenticator setup for %s accounts', async (_label, status, explanation) => {
    mocks.getCurrentMfaStatus.mockResolvedValue(status)
    await renderPage()

    expect(screen.getByText(explanation)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Set up authenticator app' })).not.toBeInTheDocument()
    expect(screen.queryByText('Off')).not.toBeInTheDocument()
  })

  it('still renders when the status cannot load', async () => {
    mocks.getCurrentMfaStatus.mockRejectedValue(new Error('TransportError'))
    await renderPage()
    expect(screen.getByText(/couldn’t load your two-step verification settings/)).toBeInTheDocument()
  })

  it('explains the admin requirement and returns the administrator to the admin page after setup', async () => {
    mocks.isPlatformAdministrator.mockResolvedValue(true)
    mocks.startAuthenticatorSetup.mockResolvedValueOnce({ status: 'ready', secret: 'ABCDEFGH', otpauthUri: 'otpauth://totp/x', qrDataUrl: 'data:image/png;base64,QR' })
    mocks.confirmAuthenticatorSetup.mockResolvedValueOnce({ status: 'enabled', message: 'Authenticator app turned on.', redirectTo: '/admin/users' })
    await renderPage({ required: 'admin', next: '/admin/users' })

    expect(screen.getByRole('status')).toHaveTextContent('Admin pages need two-step verification.')
    fireEvent.click(screen.getByRole('button', { name: 'Set up authenticator app' }))
    fireEvent.change(await screen.findByLabelText(/Enter the 6-digit code/), { target: { value: '123456' } })
    fireEvent.click(await screen.findByRole('button', { name: 'Verify and turn on' }))

    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/admin/users'))
    const submitted = mocks.confirmAuthenticatorSetup.mock.calls[0]?.[1] as FormData
    expect(submitted.get('returnTo')).toBe('/admin/users')
  })

  it('lets an administrator signed in with Google confirm with password and authenticator code, without signing out (hotfix P1)', async () => {
    mocks.isPlatformAdministrator.mockResolvedValue(true)
    mocks.getCurrentMfaStatus.mockResolvedValue({ ...on, hostedSession: true })
    await renderPage({ required: 'admin', next: '/admin/users' })

    const form = screen.getByRole('form', { name: 'Confirm it’s you to open admin pages' })
    expect(within(form).getByLabelText('Password')).toHaveAttribute('autocomplete', 'current-password')
    expect(within(form).getByLabelText('6-digit code')).toHaveAttribute('autocomplete', 'one-time-code')
    fireEvent.click(within(form).getByLabelText('Backup code'))
    expect(within(form).getByLabelText('Backup code', { selector: 'input[name="code"]' })).toBeInTheDocument()
    expect(form.querySelector('input[name="next"]')).toHaveAttribute('value', '/admin/users')
    expect(within(form).getByRole('button', { name: 'Confirm and continue' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Sign out' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Continue to the admin console' })).not.toBeInTheDocument()
    expect(mocks.hasAdminStepUp).toHaveBeenCalledWith('profile-1')
  })

  it('offers the way back once a Google sign-in has stepped up', async () => {
    mocks.isPlatformAdministrator.mockResolvedValue(true)
    mocks.getCurrentMfaStatus.mockResolvedValue({ ...on, hostedSession: true })
    mocks.hasAdminStepUp.mockResolvedValueOnce(true)
    await renderPage({ required: 'admin', next: '/admin/users' })
    expect(screen.queryByRole('form', { name: 'Confirm it’s you to open admin pages' })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Continue to the admin console' })).toHaveAttribute('href', '/admin/users')
  })

  it('explains that a Google-only sign-in must be linked first, and still needs an authenticator app', async () => {
    mocks.isPlatformAdministrator.mockResolvedValue(true)
    mocks.getCurrentMfaStatus.mockResolvedValue({ ...off, kind: 'federated', hostedSession: true })
    await renderPage({ required: 'admin', next: '/admin' })
    expect(screen.getByRole('status')).toHaveTextContent(/isn’t linked to your email-and-password account yet/)
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Confirm it’s you to open admin pages' })).not.toBeInTheDocument()
  })

  it('offers the way back once an administrator is ready, and ignores unsafe return paths', async () => {
    mocks.isPlatformAdministrator.mockResolvedValue(true)
    mocks.getCurrentMfaStatus.mockResolvedValue(on)
    await renderPage({ required: 'admin', next: 'https://evil.example/admin' })

    expect(screen.getByRole('link', { name: 'Continue to the admin console' })).toHaveAttribute('href', '/admin')
  })

  it('shows no admin notice to members who are not administrators', async () => {
    await renderPage({ required: 'admin', next: '/admin' })
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Continue to the admin console' })).not.toBeInTheDocument()
  })
})

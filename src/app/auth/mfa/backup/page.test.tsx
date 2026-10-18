import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ cookies: {} as Record<string, string> }))

vi.mock('next/headers', () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.cookies[name] ? { name, value: mocks.cookies[name] } : undefined),
  }),
}))
vi.mock('@/features/account-security/actions', () => ({ signInWithBackupCodeAction: vi.fn(async () => ({})) }))

import BackupCodeSignInPage from './page'

beforeEach(() => {
  mocks.cookies = {}
})
afterEach(() => cleanup())

describe('/auth/mfa/backup (Round H, H3)', () => {
  it('asks for a backup code during a pending 2FA sign-in, without exposing the session', async () => {
    mocks.cookies = { sns_cognito_mfa_challenge: 'opaque-session-value', sns_cognito_mfa_challenge_user: 'internal-user-1' }
    const { container } = render(await BackupCodeSignInPage())

    expect(screen.getByRole('heading', { name: 'Use a backup code' })).toBeInTheDocument()
    const code = screen.getByLabelText('Backup code')
    expect(code).toHaveAttribute('name', 'code')
    expect(code).toHaveAttribute('aria-describedby', 'backup-code-description')
    expect(screen.getByText(/Using one turns two-step verification off/)).toHaveAttribute('id', 'backup-code-description')
    expect(screen.getByRole('button', { name: 'Use backup code' })).toBeEnabled()
    expect(screen.getByRole('link', { name: 'Use your authenticator app instead' })).toHaveAttribute('href', '/auth/mfa')
    expect(container.innerHTML).not.toContain('opaque-session-value')
    expect(container.innerHTML).not.toContain('internal-user-1')
  })

  it('explains an expired sign-in session', async () => {
    render(await BackupCodeSignInPage())
    expect(screen.getByRole('alert')).toHaveTextContent('Your sign-in session expired. Please sign in again.')
    expect(screen.queryByLabelText('Backup code')).not.toBeInTheDocument()
  })
})

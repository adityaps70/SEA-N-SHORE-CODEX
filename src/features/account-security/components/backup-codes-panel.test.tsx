import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ generateBackupCodesAction: vi.fn(), refresh: vi.fn() }))
vi.mock('../actions', () => ({ generateBackupCodesAction: mocks.generateBackupCodesAction }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

import { BackupCodesPanel } from './backup-codes-panel'

const CODES = ['ABCDE-23456', 'FGHJK-34567', 'MNPQR-45678', 'STUVW-56789', 'XYZAB-67892', 'CDEFG-78923', 'HJKMN-89234', 'PQRST-92345', 'UVWXY-23457', 'ZABCD-34568']

describe('Settings › Account › Backup codes (Round H, H3)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('points members without an authenticator app to two-step verification first', () => {
    render(<BackupCodesPanel summary={{ available: false, remaining: 0, createdLabel: null }} />)
    expect(screen.getByRole('link', { name: 'Set up two-step verification' })).toHaveAttribute('href', '/settings/security')
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('asks for the password, then shows the codes once with copy and download', async () => {
    mocks.generateBackupCodesAction.mockResolvedValue({ status: 'ready', codes: CODES, regenerated: true })
    render(<BackupCodesPanel summary={{ available: true, remaining: 7, createdLabel: '1 Oct 2026' }} />)
    expect(screen.getByText('7 of 10 codes left, created 1 Oct 2026.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create new codes' }))
    expect(screen.getByText('Enter your password to make new codes. Your old codes will stop working.')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'RightPlaceholder1' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Create new codes' }).at(-1)!)

    const list = await screen.findByRole('list', { name: 'Backup codes' })
    expect(list.querySelectorAll('li')).toHaveLength(10)
    expect(screen.getByRole('status')).toHaveTextContent('New backup codes are ready. Your old codes no longer work.')
    expect(screen.getByRole('button', { name: /Copy codes/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Download/ })).toBeInTheDocument()
    const submitted = mocks.generateBackupCodesAction.mock.calls[0]?.[1] as FormData
    expect(submitted.get('currentPassword')).toBe('RightPlaceholder1')

    fireEvent.click(screen.getByRole('button', { name: 'I’ve saved my codes' }))
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Backup codes' })).not.toBeInTheDocument())
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('shows a wrong password next to the field', async () => {
    mocks.generateBackupCodesAction.mockResolvedValue({ status: 'error', error: 'Your current password is incorrect.', field: 'currentPassword' })
    render(<BackupCodesPanel summary={{ available: true, remaining: 0, createdLabel: null }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Create backup codes' }))
    fireEvent.change(screen.getByLabelText('Current password'), { target: { value: 'WrongPlaceholder1' } })
    fireEvent.click(screen.getAllByRole('button', { name: 'Create backup codes' }).at(-1)!)
    await waitFor(() => expect(screen.getByLabelText('Current password')).toHaveAttribute('aria-invalid', 'true'))
    expect(screen.getByText('Your current password is incorrect.')).toHaveAttribute('id', 'backup-codes-password-description')
  })
})

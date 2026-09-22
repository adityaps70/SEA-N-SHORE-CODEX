import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/features/account-deletion/components/delete-account-panel', () => ({
  DeleteAccountPanel: () => <div>Delete account controls</div>,
}))

import SettingsPage from './page'

describe('SettingsPage', () => {
  it('places permanent account deletion under user Settings', () => {
    render(<SettingsPage />)

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Account & privacy' })).toBeInTheDocument()
    expect(screen.getByText('Delete account controls')).toBeInTheDocument()
  })
})

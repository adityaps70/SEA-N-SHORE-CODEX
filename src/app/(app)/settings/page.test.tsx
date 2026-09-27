import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/account-export/components/data-export-panel', () => ({
  DataExportPanel: () => <div>Data export controls</div>,
}))

vi.mock('@/features/account-deletion/components/delete-account-panel', () => ({
  DeleteAccountPanel: () => <div>Delete account controls</div>,
}))

import SettingsPage from './page'

describe('SettingsPage', () => {
  afterEach(() => cleanup())

  it('places data export and permanent account deletion under user Settings', () => {
    render(<SettingsPage />)

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Account & privacy' })).toBeInTheDocument()
    expect(screen.getByText('Data export controls')).toBeInTheDocument()
    expect(screen.getByText('Delete account controls')).toBeInTheDocument()
  })

  it('makes every settings card that navigates look clickable, and keeps the security note from looking like a card', () => {
    const { container } = render(<SettingsPage />)

    const billing = screen.getByRole('link', { name: /Membership & billing/ })
    expect(billing).toHaveAttribute('href', '/settings/billing')
    expect(billing).toHaveClass('border-mist-200', 'hover:border-ocean-300')
    expect(billing.querySelector('svg.lucide-chevron-right')).not.toBeNull()
    expect(container.querySelectorAll('a svg.lucide-chevron-right')).toHaveLength(6)

    const security = screen.getByText('Security:').closest('p')
    expect(security).not.toBeNull()
    expect(security?.closest('a')).toBeNull()
    expect(within(security as HTMLElement).getByText(/fresh password verification/)).toBeInTheDocument()
  })
})

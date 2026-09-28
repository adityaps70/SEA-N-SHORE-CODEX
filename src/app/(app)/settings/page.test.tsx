import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/account-export/components/data-export-panel', () => ({
  DataExportPanel: () => <div>Data export controls</div>,
}))

vi.mock('@/features/account-deletion/components/delete-account-section', () => ({
  DeleteAccountSection: () => <div>Delete account controls</div>,
}))

vi.mock('@/features/auth/components/account-phone-section', () => ({
  AccountPhoneSection: () => <div>Mobile number controls</div>,
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
    expect(screen.getByText('Mobile number controls')).toBeInTheDocument()
  })

  it('lists My Activities under Account & privacy, now that the header has no More menu', () => {
    render(<SettingsPage />)

    const section = screen.getByRole('heading', { name: 'Account & privacy' }).closest('section') as HTMLElement
    const activities = within(section).getByRole('link', { name: /My Activities/ })
    expect(activities).toHaveAttribute('href', '/activities')
    expect(activities).toHaveClass('border-mist-200', 'hover:border-ocean-300')
  })

  it('makes every settings card that navigates look clickable, and keeps the security note from looking like a card', () => {
    const { container } = render(<SettingsPage />)

    const billing = screen.getByRole('link', { name: /Membership & billing/ })
    expect(billing).toHaveAttribute('href', '/settings/billing')
    expect(billing).toHaveClass('border-mist-200', 'hover:border-ocean-300')
    expect(billing.querySelector('svg.lucide-chevron-right')).not.toBeNull()
    expect(container.querySelectorAll('a svg.lucide-chevron-right')).toHaveLength(9)
    expect(screen.getByRole('link', { name: /Earnings/ })).toHaveAttribute('href', '/settings/earnings')
    expect(screen.getByRole('link', { name: /Payout details/ })).toHaveAttribute('href', '/settings/payouts')

    const security = screen.getByText('Security:').closest('p')
    expect(security).not.toBeNull()
    expect(security?.closest('a')).toBeNull()
    expect(within(security as HTMLElement).getByText(/fresh password verification/)).toBeInTheDocument()
  })
})

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAccessContext: vi.fn(),
}))

vi.mock('@/features/account-export/components/data-export-panel', () => ({
  DataExportPanel: () => <div>Data export controls</div>,
}))

vi.mock('@/features/account-deletion/components/delete-account-section', () => ({
  DeleteAccountSection: () => <div>Delete account controls</div>,
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))

import SettingsPage from './page'

async function renderSettings() {
  return render(await SettingsPage())
}

function desktopSection() {
  return screen.getByRole('heading', { name: 'Account & privacy' }).closest('section') as HTMLElement
}

describe('SettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
    mocks.getAccessContext.mockResolvedValue({ personalPlan: 'free' })
  })
  afterEach(() => cleanup())

  it('places data export and permanent account deletion under user Settings', async () => {
    await renderSettings()

    expect(screen.getByRole('heading', { name: 'Settings' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Account & privacy' })).toBeInTheDocument()
    expect(screen.getByText('Data export controls')).toBeInTheDocument()
    expect(screen.getByText('Delete account controls')).toBeInTheDocument()
  })

  it('no longer shows or asks for a mobile number', async () => {
    await renderSettings()

    expect(document.getElementById('mobile-number')).toBeNull()
    expect(screen.queryByText(/mobile number/i)).not.toBeInTheDocument()
    expect(screen.getByText(/Manage your account security, privacy, and permanent account actions/)).toBeInTheDocument()
  })

  it('lists My Activities under Account & privacy, now that the header has no More menu', async () => {
    await renderSettings()

    const activities = within(desktopSection()).getByRole('link', { name: /My Activities/ })
    expect(activities).toHaveAttribute('href', '/activities')
    expect(activities).toHaveClass('border-mist-200', 'hover:border-ocean-300')
  })

  it('makes every settings card that navigates look clickable, and keeps the security note from looking like a card', async () => {
    await renderSettings()
    const section = desktopSection()

    const billing = within(section).getByRole('link', { name: /Membership & billing/ })
    expect(billing).toHaveAttribute('href', '/settings/billing')
    expect(billing).toHaveClass('border-mist-200', 'hover:border-ocean-300')
    expect(billing.querySelector('svg.lucide-chevron-right')).not.toBeNull()
    expect(section.querySelectorAll('a svg.lucide-chevron-right')).toHaveLength(10)
    expect(within(section).getByRole('link', { name: /Earnings/ })).toHaveAttribute('href', '/settings/earnings')
    expect(within(section).getByRole('link', { name: /Payout details/ })).toHaveAttribute('href', '/settings/payouts')
    expect(within(section).getByRole('link', { name: /Blocked members/ })).toHaveAttribute('href', '/settings/blocked')

    const security = screen.getByText('Security:').closest('p')
    expect(security).not.toBeNull()
    expect(security?.closest('a')).toBeNull()
    expect(within(security as HTMLElement).getByText(/fresh password verification/)).toBeInTheDocument()
  })

  it('shows phones a grouped list with every destination and the plan', async () => {
    await renderSettings()

    const list = screen.getByRole('navigation', { name: 'Settings' })
    expect(list).toHaveClass('md:hidden')
    expect(desktopSection()).toHaveClass('max-md:hidden')
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/home')

    const groups = within(list).getAllByRole('heading').map((heading) => heading.textContent)
    expect(groups).toEqual(['Account', 'Sign in & security', 'Visibility & activity', 'Communications', 'Data & privacy'])

    const destinations = within(list).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])
    expect(destinations).toEqual([
      ['Profile information', '/profile/edit'],
      ['Plan & billingFree', '/settings/billing'],
      ['Earnings', '/settings/earnings'],
      ['Payout details', '/settings/payouts'],
      ['Verifications', '/settings/verifications'],
      ['Creator access', '/creator'],
      ['Organizations', '/organizations'],
      ['Password & Google sign-in', '/auth/forgot-password'],
      ['My Activities', '/activities'],
      ['Hidden posts', '/activities?tab=hidden'],
      ['Blocked members', '/settings/blocked'],
      ['Newsletter', '/newsletter'],
      ['Download my data', '#download-data'],
      ['Privacy policy', '/privacy'],
      ['Delete account', '#delete-account'],
    ])
    expect(within(list).getByRole('link', { name: 'Delete account' })).toHaveClass('text-red-700')

    // Same-page panels the rows point at stay on the page (fully usable on phones).
    for (const id of ['download-data', 'delete-account']) {
      expect(document.getElementById(id)).not.toBeNull()
    }
    expect(document.getElementById('download-data')).toHaveTextContent('Data export controls')
    expect(document.getElementById('delete-account')).toHaveTextContent('Delete account controls')
  })

  it('shows Creator Pro as the plan, and still renders when the plan cannot load', async () => {
    mocks.getAccessContext.mockResolvedValueOnce({ personalPlan: 'creator_pro' })
    await renderSettings()
    const list = screen.getByRole('navigation', { name: 'Settings' })
    expect(within(list).getByRole('link', { name: /Plan & billing/ })).toHaveTextContent('Creator Pro')
    cleanup()

    mocks.getAccessContext.mockRejectedValueOnce(new Error('db down'))
    await renderSettings()
    expect(within(screen.getByRole('navigation', { name: 'Settings' })).getByRole('link', { name: 'Plan & billing' })).toBeInTheDocument()
  })
})

import { readFileSync } from 'node:fs'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/image', () => ({ default: () => <span data-testid="logo" /> }))

import { OrganizationManageShell } from './organization-manage-shell'
import { OrganizationUpgradeAction } from './organization-upgrade-action'

afterEach(() => cleanup())

const workspace = { id: 'c1', slug: 'harbour-minds', name: 'Harbour Minds', logoPath: null }

describe('OrganizationUpgradeAction', () => {
  it('sends an owner of a verified free organization to Plan & billing', () => {
    render(<OrganizationUpgradeAction slug="harbour-minds" canBuy plan="free" verified />)
    expect(screen.getByRole('link', { name: 'Upgrade to Organization Pro' })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=billing')
  })

  it('explains verification to an owner whose organization is not verified yet', () => {
    render(<OrganizationUpgradeAction slug="harbour-minds" canBuy plan="free" verified={false} />)
    expect(screen.getByText(/can be bought once Sea N Shore verifies this organization/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See Plan & billing' })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=billing')
  })

  it('tells other members who can upgrade, or who can change their role', () => {
    const { rerender } = render(<OrganizationUpgradeAction slug="harbour-minds" canBuy={false} plan="free" verified />)
    expect(screen.getByText('Ask an owner or administrator to upgrade to Organization Pro.')).toBeInTheDocument()
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    rerender(<OrganizationUpgradeAction slug="harbour-minds" canBuy={false} plan="organization_pro" verified />)
    expect(screen.getByText('Ask an owner or administrator of this organization to change your role.')).toBeInTheDocument()
  })

  it('replaces the /plans loop on the Team, Branding and Analytics screens', () => {
    for (const page of ['team', 'branding', 'analytics']) {
      const source = readFileSync(`src/app/(app)/organizations/[slug]/${page}/page.tsx`, 'utf8')
      expect(source).toContain('<OrganizationUpgradeAction')
      expect(source).not.toContain('href="/plans"')
    }
  })
})

describe('OrganizationManageShell Plan & billing', () => {
  it('shows Plan & billing in the side navigation only when asked to', () => {
    const { rerender } = render(
      <OrganizationManageShell workspace={workspace} active="overview" showRequests={false} showBilling>
        <p>Body</p>
      </OrganizationManageShell>,
    )
    const nav = screen.getByRole('navigation', { name: 'Manage page sections' })
    expect(within(nav).getByRole('link', { name: 'Plan & billing' })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=billing')

    rerender(
      <OrganizationManageShell workspace={workspace} active="billing" showRequests={false} showBilling>
        <p>Body</p>
      </OrganizationManageShell>,
    )
    expect(within(nav).getByRole('link', { name: 'Plan & billing' })).toHaveAttribute('aria-current', 'page')

    rerender(
      <OrganizationManageShell workspace={workspace} active="overview" showRequests={false}>
        <p>Body</p>
      </OrganizationManageShell>,
    )
    expect(within(nav).queryByRole('link', { name: 'Plan & billing' })).not.toBeInTheDocument()
  })
})

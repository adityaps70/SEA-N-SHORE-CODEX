import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  configured: true,
  accounts: new Map<string, unknown>(),
  busy: new Set<string>(),
  orgs: [] as Array<{ id: string; name: string; slug: string; role: string }>,
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: async () => ({ id: '44444444-4444-4444-8444-444444444444', cognitoSub: 's', email: null }) }))
vi.mock('@/features/payouts/actions', () => ({ savePayoutAccountAction: vi.fn(), removePayoutAccountAction: vi.fn() }))
vi.mock('@/features/payouts/payout-runtime', () => ({ arePayoutsConfigured: async () => mocks.configured, readClient: {} }))
vi.mock('@/features/payouts/payout-repository', () => ({
  listManagedOrganizations: async () => mocks.orgs,
  getActivePayoutAccount: async (_client: unknown, seller: { profileId?: string; companyId?: string }) => mocks.accounts.get(seller.companyId ?? seller.profileId ?? '') ?? null,
  hasOpenPayout: async (_client: unknown, seller: { profileId?: string; companyId?: string }) => mocks.busy.has(seller.companyId ?? seller.profileId ?? ''),
}))

import PayoutSettingsPage from './page'

const COMPANY = '55555555-5555-4555-8555-555555555555'

beforeEach(() => {
  mocks.configured = true
  mocks.accounts.clear()
  mocks.busy.clear()
  mocks.orgs = []
})
afterEach(() => cleanup())

describe('Settings → Payout details', () => {
  it('explains that payouts are not set up and shows no form', async () => {
    mocks.configured = false
    render(await PayoutSettingsPage())
    expect(screen.getByRole('heading', { name: 'Payouts are not switched on yet' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See your earnings' })).toHaveAttribute('href', '/settings/earnings')
  })

  it('shows one panel for the member and one per organization they own or administer', async () => {
    mocks.orgs = [{ id: COMPANY, name: 'Blue Anchor Shipping', slug: 'blue-anchor', role: 'owner' }]
    mocks.accounts.set(COMPANY, {
      id: 'a', seller: { companyId: COMPANY }, method: 'upi', holderName: 'Blue Anchor Shipping', ifsc: null, last4: null, vpa: 'blueanchor@okicici',
      providerBeneficiaryId: 'snsb_x', providerStatus: 'VERIFIED', providerVerified: true, status: 'active', createdAt: '2026-09-01T10:00:00.000Z',
    })
    mocks.busy.add(COMPANY)
    render(await PayoutSettingsPage())
    expect(screen.getByRole('heading', { name: 'Your payout details' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add payout details' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Blue Anchor Shipping' })).toBeInTheDocument()
    expect(screen.getByText('UPI bl•••@okicici')).toBeInTheDocument()
    expect(screen.queryByText('blueanchor@okicici')).not.toBeInTheDocument()
    expect(screen.getByText(/A payout is on its way to these details/)).toBeInTheDocument()
  })
})

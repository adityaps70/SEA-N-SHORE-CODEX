import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getAccessContext: vi.fn(),
  getBySlug: vi.fn(),
  getViewer: vi.fn(),
  listForOrganization: vi.fn(),
  getUserOrganizationState: vi.fn(),
  loadPlanBillingView: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`) }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('next/image', () => ({ default: (props: Record<string, unknown>) => <span data-testid="logo" data-src={String(props.src)} /> }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))
vi.mock('@/features/organizations/workspace-repository', () => ({
  organizationWorkspaceRepository: { getBySlug: mocks.getBySlug },
}))
vi.mock('@/features/organizations/access-request-repository', () => ({
  organizationAccessRequestRepository: { getViewer: mocks.getViewer, listForOrganization: mocks.listForOrganization },
}))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { getUserOrganizationState: mocks.getUserOrganizationState },
}))
vi.mock('@/features/organizations/access-request-actions', () => ({ decideOrganizationAccessRequest: vi.fn() }))
vi.mock('@/features/billing/page-data', () => ({ loadPlanBillingView: mocks.loadPlanBillingView }))
vi.mock('@/features/billing/actions', () => ({
  startPlanCheckoutAction: vi.fn(),
  checkPlanCheckoutAction: vi.fn(),
  cancelAutoRenewAction: vi.fn(),
}))

import { buildPlanBillingView } from '@/features/billing/billing-view'
import { testPrice } from '@/features/billing/testing/memory-billing-store'
import type { AccessRecord, CheckoutRecord } from '@/features/billing/subscription-types'
import OrganizationManagePage from './page'

const orgPrices = [
  testPrice({ id: 'om', planCode: 'organization_pro', amountMinor: 500000 }),
  testPrice({ id: 'oy', planCode: 'organization_pro', interval: 'year', amountMinor: 5000000 }),
]
const emptyBilling = { access: null, accessIsCurrent: false, checkout: null, pendingCheckout: null, payments: [], trial: null }
const freeOrganizationView = buildPlanBillingView({ plan: 'organization_pro', billing: emptyBilling, prices: orgPrices, configured: true })

const NOW = new Date('2026-10-10T06:00:00.000Z')
const subject = { kind: 'company' as const, companyId: 'c1' }
const proCheckout: CheckoutRecord = {
  id: 'k1', subject, createdBy: 'user-1', planCode: 'organization_pro', planPriceId: 'om',
  interval: 'month', amountMinor: 500000, currency: 'INR', environment: 'sandbox', providerSubscriptionId: 'snss_k1', cfSubscriptionId: null,
  sessionId: null, status: 'active', providerStatus: 'ACTIVE', paymentMethod: 'upi', startsAt: null, nextChargeAt: '2026-11-01T06:00:00.000Z',
  paidThroughAt: '2026-11-01T06:00:00.000Z', replacesCheckoutId: null, failureReason: null, lastCheckedAt: null, lastStatusEventAt: null,
  activatedAt: '2026-10-01T06:00:00.000Z', cancelledAt: null, createdAt: '2026-10-01T06:00:00.000Z', updatedAt: '2026-10-01T06:00:00.000Z',
}
const proAccess: AccessRecord = {
  id: 'a1', subject, planCode: 'organization_pro', status: 'active', billingProvider: 'cashfree',
  providerSubscriptionId: 'snss_k1', periodStartedAt: '2026-10-01T06:00:00.000Z', periodEndsAt: '2026-11-04T06:00:00.000Z',
  cancelAtPeriodEnd: false, createdAt: '2026-10-01T06:00:00.000Z', updatedAt: '2026-10-01T06:00:00.000Z',
}
const proOrganizationView = buildPlanBillingView({
  plan: 'organization_pro',
  billing: { ...emptyBilling, access: proAccess, accessIsCurrent: true, checkout: proCheckout },
  prices: orgPrices,
  configured: true,
  now: NOW,
})

const workspace = {
  id: 'c1',
  slug: 'harbour-minds',
  name: 'Harbour Minds',
  logoPath: null,
  coverPath: null,
  verified: true,
}

const pendingRequest = {
  id: 'r1',
  status: 'pending',
  requestedRole: 'member',
  grantedRole: null,
  message: 'I work in the Manila office.',
  requestedAt: new Date().toISOString(),
  reviewedAt: null,
  reviewerNote: null,
  reviewerName: null,
  decidedVia: null,
  escalatedAt: null,
  escalationNote: null,
  requester: { id: 'u9', fullName: 'Grace Santos', slug: 'grace', headline: 'Counsellor' },
}

function access(role: string | null, plan = 'free') {
  return {
    personalPlan: 'free',
    personalEntitlements: [],
    verifications: [],
    organizationMemberships: role ? [{ companyId: 'c1', plan, role, verified: true, entitlements: [] }] : [],
    accountActive: true,
  }
}

const params = Promise.resolve({ slug: 'harbour-minds' })
const section = (value: string) => Promise.resolve({ section: value })

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.getBySlug.mockResolvedValue(workspace)
  mocks.getUserOrganizationState.mockResolvedValue({ kind: 'none' })
  mocks.getViewer.mockResolvedValue(null)
  mocks.listForOrganization.mockResolvedValue({ viewer: { kind: 'organization', role: 'owner' }, requests: [pendingRequest] })
  mocks.loadPlanBillingView.mockResolvedValue(freeOrganizationView)
})

describe('/organizations/[slug]/manage', () => {
  it('gives owners the overview with role, verification, waiting requests and locked tools without dead-end links', async () => {
    mocks.getAccessContext.mockResolvedValue(access('owner'))
    mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'owner' })
    render(await OrganizationManagePage({ params }))

    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Manage page sections' })
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: /Requests/ })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=requests')
    expect(within(nav).getByRole('link', { name: /Requests/ })).toHaveTextContent('1 waiting')
    expect(within(nav).getByRole('link', { name: /Team & roles/ })).toHaveAttribute('href', '/organizations/harbour-minds/team')
    expect(within(nav).getByRole('link', { name: /Branding/ })).toHaveAttribute('href', '/organizations/harbour-minds/branding')
    expect(within(nav).getByRole('link', { name: /Analytics/ })).toHaveAttribute('href', '/organizations/harbour-minds/analytics')
    expect(screen.getByRole('link', { name: /View page/ })).toHaveAttribute('href', '/organizations/harbour-minds')

    expect(screen.getByText('Verified by Sea N Shore')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Review requests/ })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=requests')
    const tools = screen.getByRole('region', { name: 'Your workspace' })
    expect(within(tools).getByText('Owner · Free plan')).toBeInTheDocument()
    // Locked tools lead the owner to Plan & billing, never back to /plans.
    expect(within(tools).getByRole('link', { name: /Team & roles/ })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=billing')
    expect(within(tools).getAllByText('Included with Organization Pro')).toHaveLength(6)
    expect(within(tools).getByRole('link', { name: 'Upgrade to Organization Pro' })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=billing')
    expect(screen.queryByRole('link', { name: 'Compare plans' })).not.toBeInTheDocument()
    expect(document.querySelector('a[href="/plans"]')).toBeNull()
    expect(within(nav).getByRole('link', { name: 'Plan & billing' })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=billing')
  })

  it('shows a phone page bar back to the page titled with the section, and a scroll hint on the section row', async () => {
    mocks.getAccessContext.mockResolvedValue(access('owner'))
    mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'owner' })
    render(await OrganizationManagePage({ params, searchParams: section('billing') }))
    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/organizations/harbour-minds')
    expect(screen.getByText('Manage · Plan & billing')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Manage page sections' })
    expect(nav.querySelector('[aria-hidden="true"].bg-gradient-to-l')).not.toBeNull()
  })

  it('shows the Requests section to owners so they can decide', async () => {
    mocks.getAccessContext.mockResolvedValue(access('owner'))
    mocks.getViewer.mockResolvedValue({ kind: 'organization', role: 'owner' })
    render(await OrganizationManagePage({ params, searchParams: section('requests') }))

    expect(mocks.listForOrganization).toHaveBeenCalledWith('user-1', 'c1')
    expect(screen.getByRole('region', { name: /Requests/ })).toHaveAttribute('id', 'requests')
    expect(screen.getByText('Grace Santos')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Requests/ })).toHaveAttribute('aria-current', 'page')
  })

  it('shows platform administrators the Requests section read-only', async () => {
    mocks.getAccessContext.mockResolvedValue(access(null))
    mocks.getViewer.mockResolvedValue({ kind: 'platform' })
    render(await OrganizationManagePage({ params, searchParams: section('requests') }))
    expect(screen.getByText(/Read-only: the owner and administrators of Harbour Minds decide/)).toBeInTheDocument()
  })

  it('hides Requests from members who cannot decide them and never loads the list', async () => {
    mocks.getAccessContext.mockResolvedValue(access('recruiter', 'organization_pro'))
    render(await OrganizationManagePage({ params, searchParams: section('requests') }))
    expect(mocks.listForOrganization).not.toHaveBeenCalled()
    expect(screen.queryByRole('link', { name: /Requests/ })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.getByText('The owner and administrators decide who joins.')).toBeInTheDocument()
  })

  it('shows the verification status to the owner of an organization still being verified', async () => {
    mocks.getAccessContext.mockResolvedValue(access(null))
    mocks.getUserOrganizationState.mockResolvedValue({
      kind: 'application',
      applicationId: 'a1',
      status: 'changes_requested',
      submittedAt: '2026-09-20T10:00:00.000Z',
      updatedAt: '2026-09-20T10:00:00.000Z',
      adminReviewNote: 'Add your registration number.',
      company: { id: 'c1', slug: 'harbour-minds', name: 'Harbour Minds', verified: false },
      membership: { role: 'owner', approvedAt: null },
    })
    mocks.getBySlug.mockResolvedValue({ ...workspace, verified: false })
    render(await OrganizationManagePage({ params }))
    expect(screen.getByText('Your organization application needs attention')).toBeInTheDocument()
    expect(screen.getByText('Note from Sea N Shore: Add your registration number.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to your application' })).toHaveAttribute('href', '/organizations#update-application')
    expect(screen.queryByRole('region', { name: 'Your workspace' })).not.toBeInTheDocument()
  })

  it('shows Plan & billing to administrators on the free plan with the Organization Pro checkout inline', async () => {
    mocks.getAccessContext.mockResolvedValue(access('administrator'))
    render(await OrganizationManagePage({ params, searchParams: section('billing') }))

    expect(mocks.loadPlanBillingView).toHaveBeenCalledWith({ kind: 'company', companyId: 'c1' })
    expect(screen.getByRole('heading', { level: 1, name: 'Plan & billing' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Plan & billing' })).toHaveAttribute('aria-current', 'page')
    const plan = screen.getByRole('region', { name: 'Organization Pro' })
    expect(within(plan).getByText('Free plan')).toBeInTheDocument()
    expect(within(plan).getByRole('heading', { level: 3, name: 'Try Organization Pro free for 2 months' })).toBeInTheDocument()
    expect(within(plan).getByRole('heading', { level: 3, name: 'Or choose a paid plan now' })).toBeInTheDocument()
    expect(within(plan).getByRole('group', { name: /How often do you want to pay/ })).toBeInTheDocument()
    expect(within(plan).getByRole('button', { name: /Set up auto-pay/ })).toBeInTheDocument()
  })

  it('shows an Organization Pro workspace its status, next renewal and Cancel auto-renew', async () => {
    mocks.getAccessContext.mockResolvedValue(access('owner', 'organization_pro'))
    mocks.loadPlanBillingView.mockResolvedValue(proOrganizationView)
    render(await OrganizationManagePage({ params, searchParams: section('billing') }))

    const plan = screen.getByRole('region', { name: 'Organization Pro' })
    expect(within(plan).getByText('Active — renews automatically')).toBeInTheDocument()
    expect(within(plan).getByText('Next payment')).toBeInTheDocument()
    expect(within(plan).getByRole('button', { name: 'Cancel auto-renew' })).toBeInTheDocument()
    expect(within(plan).queryByRole('group', { name: /How often do you want to pay/ })).not.toBeInTheDocument()
  })

  it('explains why an organization that is not verified cannot buy yet', async () => {
    mocks.getAccessContext.mockResolvedValue({ ...access('owner'), organizationMemberships: [{ companyId: 'c1', plan: 'free', role: 'owner', verified: false, entitlements: [] }] })
    mocks.getBySlug.mockResolvedValue({ ...workspace, verified: false })
    render(await OrganizationManagePage({ params, searchParams: section('billing') }))

    expect(screen.getByText(/Organization Pro can be bought once Sea N Shore has verified this organization/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Set up auto-pay/ })).not.toBeInTheDocument()
  })

  it('shows a clear message when the plan cannot be loaded', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    mocks.getAccessContext.mockResolvedValue(access('owner'))
    mocks.loadPlanBillingView.mockRejectedValue(new Error('db down'))
    render(await OrganizationManagePage({ params, searchParams: section('billing') }))

    expect(screen.getByRole('alert')).toHaveTextContent('We couldn’t load this organization’s plan just now.')
    error.mockRestore()
  })

  it('hides Plan & billing from roles that cannot buy and tells them who can upgrade', async () => {
    mocks.getAccessContext.mockResolvedValue(access('recruiter'))
    render(await OrganizationManagePage({ params, searchParams: section('billing') }))

    expect(mocks.loadPlanBillingView).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1, name: 'Overview' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Plan & billing/ })).not.toBeInTheDocument()
    const tools = screen.getByRole('region', { name: 'Your workspace' })
    expect(within(tools).getByText(/Ask an owner or administrator to upgrade to Organization Pro/)).toBeInTheDocument()
    expect(within(tools).queryByRole('link', { name: /Team & roles/ })).not.toBeInTheDocument()
  })

  it('always gives the owner of an Organization Pro workspace a Plan & billing link, even without billing.manage', async () => {
    mocks.getAccessContext.mockResolvedValue(access('owner', 'organization_pro'))
    render(await OrganizationManagePage({ params }))

    const tools = screen.getByRole('region', { name: 'Your workspace' })
    expect(within(tools).getByRole('link', { name: /Plan & billing/ })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=billing')
  })

  it('sends people without a role back to the public page', async () => {
    mocks.getAccessContext.mockResolvedValue(access(null))
    await expect(OrganizationManagePage({ params })).rejects.toThrow('NEXT_REDIRECT:/organizations/harbour-minds')
    expect(mocks.listForOrganization).not.toHaveBeenCalled()
  })
})

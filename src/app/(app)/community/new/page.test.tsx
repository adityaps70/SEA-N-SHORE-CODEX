import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CommunityCreationOptions, CommunityCreationOrganization } from '@/features/community/eligibility-server'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getCommunityCreationEligibility: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/community/eligibility-server', () => ({ getCommunityCreationEligibility: mocks.getCommunityCreationEligibility }))
vi.mock('@/features/community/create-actions', () => ({ createCommunity: vi.fn() }))

import CreateCommunityPage from './page'

const companyId = '33333333-3333-4333-8333-333333333333'

function organization(overrides: Partial<CommunityCreationOrganization> = {}): CommunityCreationOrganization {
  return { id: companyId, slug: 'harbour-minds', name: 'Harbour Minds', role: 'owner', allowed: true, reason: null, ...overrides }
}

function options(input: { member?: CommunityCreationOptions['eligibility']['asMember']; organizations?: CommunityCreationOrganization[]; isPlatformAdmin?: boolean } = {}): CommunityCreationOptions {
  const asMember = input.member ?? { allowed: true, reason: null }
  const organizations = input.organizations ?? []
  const canCreate = asMember.allowed || organizations.some((entry) => entry.allowed)
  return {
    isPlatformAdmin: input.isPlatformAdmin ?? false,
    personalPlan: asMember.allowed ? 'creator_pro' : 'free',
    organizations,
    eligibility: {
      canCreate,
      reasons: canCreate ? [] : [...new Set([asMember.reason, ...organizations.map((entry) => entry.reason)].filter((reason): reason is NonNullable<typeof reason> => reason !== null))],
      asMember,
      asOrganizations: organizations.map((entry) => ({ companyId: entry.id, allowed: entry.allowed, reason: entry.reason })),
    },
  }
}

const search = (value: Record<string, string> = {}) => Promise.resolve(value)

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'viewer-1' })
  mocks.getCommunityCreationEligibility.mockResolvedValue(options())
})

describe('/community/new', () => {
  it('shows the form to a Creator Pro member: name, description, rules, join setting, visibility and the two images', async () => {
    render(await CreateCommunityPage({ searchParams: search() }))
    expect(mocks.getCommunityCreationEligibility).toHaveBeenCalledWith('viewer-1')
    const form = screen.getByRole('form', { name: 'Create a community' })
    expect(within(form).getByLabelText(/^Name/)).toHaveAttribute('maxlength', '80')
    expect(within(form).getByLabelText('Description')).toBeInTheDocument()
    expect(within(form).getByLabelText('Rules')).toBeInTheDocument()
    expect(within(form).getByRole('radio', { name: /Open — anyone can join/ })).toBeChecked()
    expect(within(form).getByRole('radio', { name: /Approval required — a moderator approves requests/ })).not.toBeChecked()
    expect(within(form).getByRole('radio', { name: /^Public/ })).toBeChecked()
    expect(within(form).getByRole('radio', { name: /^Private/ })).toBeInTheDocument()
    const cover = form.querySelector('input[name="cover"]')
    const icon = form.querySelector('input[name="icon"]')
    expect(cover).toHaveAttribute('type', 'file')
    expect(cover?.closest('label')).toHaveTextContent(/^Banner/)
    expect(icon).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    expect(icon?.closest('label')).toHaveTextContent(/^Profile photo/)
    // One identity: no chooser, a hidden "as" value.
    expect(within(form).queryByRole('group', { name: 'Create as' })).not.toBeInTheDocument()
    expect(form.querySelector('input[name="as"]')).toHaveAttribute('value', 'me')
    expect(within(form).getByRole('button', { name: 'Create community' })).toBeEnabled()
    expect(screen.queryByRole('link', { name: /See plans/ })).not.toBeInTheDocument()
  })

  it('offers a "Create as" chooser when the member can create for themselves and for an Organization Pro organization, preselecting ?as=', async () => {
    mocks.getCommunityCreationEligibility.mockResolvedValue(options({ organizations: [organization(), organization({ id: 'c2', slug: 'other', name: 'Other Co', allowed: false, reason: 'organization_pro_required' })] }))
    render(await CreateCommunityPage({ searchParams: search({ as: companyId }) }))
    const chooser = screen.getByRole('group', { name: 'Create as' })
    expect(within(chooser).getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual(['me', companyId])
    expect(within(chooser).getByRole('radio', { name: /Harbour Minds/ })).toBeChecked()
    expect(within(chooser).getByText('Organization Pro')).toBeInTheDocument()
    expect(within(chooser).queryByText('Other Co')).not.toBeInTheDocument()
  })

  it('explains Creator Pro and Organization Pro with a link to /plans instead of a dead button', async () => {
    mocks.getCommunityCreationEligibility.mockResolvedValue(options({
      member: { allowed: false, reason: 'creator_pro_required' },
      organizations: [organization({ allowed: false, reason: 'organization_pro_required' })],
    }))
    render(await CreateCommunityPage({ searchParams: search() }))
    expect(screen.getByRole('heading', { name: 'Creating a community is part of Creator Pro and Organization Pro' })).toBeInTheDocument()
    const reasons = screen.getByRole('list', { name: 'Why you cannot create a community right now' })
    expect(within(reasons).getByText('Creating a community for yourself is part of Creator Pro.')).toBeInTheDocument()
    expect(within(reasons).getByText('Harbour Minds is not on Organization Pro.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /See plans/ })).toHaveAttribute('href', '/plans')
    expect(screen.getByRole('link', { name: 'Get Organization Pro' })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=billing')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('explains the one-community limit', async () => {
    mocks.getCommunityCreationEligibility.mockResolvedValue(options({ member: { allowed: false, reason: 'limit_reached' } }))
    render(await CreateCommunityPage({ searchParams: search() }))
    expect(screen.getByText(/Each member and each organization can run one community at a time/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/plans')
    expect(screen.getByRole('link', { name: 'Browse communities' })).toHaveAttribute('href', '/community')
  })

  it('tells an organization administrator that Organization Pro is required when ?as= names a free organization', async () => {
    mocks.getCommunityCreationEligibility.mockResolvedValue(options({
      member: { allowed: true, reason: null },
      organizations: [organization({ role: 'administrator', allowed: false, reason: 'organization_pro_required' })],
    }))
    render(await CreateCommunityPage({ searchParams: search({ as: companyId }) }))
    expect(screen.getByRole('heading', { name: 'Harbour Minds needs Organization Pro to create a community' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Get Organization Pro/ })).toHaveAttribute('href', '/organizations/harbour-minds/manage?section=billing')
    expect(screen.getByRole('link', { name: 'Create as yourself instead' })).toHaveAttribute('href', '/community/new')
    expect(screen.queryByRole('form')).not.toBeInTheDocument()
  })

  it('gives phones a page bar back to /community and hides the desktop intro', async () => {
    render(await CreateCommunityPage({ searchParams: search() }))
    const back = screen.getByRole('link', { name: 'Back' })
    expect(back).toHaveAttribute('href', '/community')
    expect(back.parentElement).toHaveClass('md:hidden')
    expect(screen.getByRole('heading', { level: 1, name: 'Create a community' }).closest('header')).toHaveClass('max-md:sr-only')
    expect(screen.getByRole('form').closest('section')).toHaveClass('max-md:-mx-4', 'max-md:rounded-none')
  })
})

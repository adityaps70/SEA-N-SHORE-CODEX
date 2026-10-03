import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getUserOrganizationState: vi.fn(),
  getClaimableOrganization: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
  redirect: vi.fn((path: string) => { throw new Error(`NEXT_REDIRECT:${path}`) }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, redirect: mocks.redirect }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { getUserOrganizationState: mocks.getUserOrganizationState },
}))
vi.mock('@/features/organizations/unclaimed-organization-repository', () => ({
  unclaimedOrganizationRepository: { getClaimableOrganization: mocks.getClaimableOrganization },
}))
vi.mock('@/features/organizations/components/organization-application-form', () => ({
  OrganizationApplicationForm: (props: { mode: string; companyId?: string; initial?: { organizationName: string } }) => (
    <form aria-label="Claim organization page" data-mode={props.mode} data-company={props.companyId} data-name={props.initial?.organizationName} />
  ),
}))

import ClaimOrganizationPage from './page'

const claimable = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'harbour-crew',
  name: 'Harbour Crew',
  logoUrl: null,
  unclaimed: true,
  prefill: { organizationName: 'Harbour Crew' },
}
const params = Promise.resolve({ slug: 'harbour-crew' })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
  mocks.getUserOrganizationState.mockResolvedValue({ kind: 'none' })
  mocks.getClaimableOrganization.mockResolvedValue(claimable)
})
afterEach(() => cleanup())

describe('/organizations/[slug]/claim', () => {
  it('shows the verification form prefilled with the page details', async () => {
    render(await ClaimOrganizationPage({ params }))

    expect(screen.getByRole('heading', { level: 1, name: 'Claim Harbour Crew' })).toBeInTheDocument()
    const form = screen.getByRole('form', { name: 'Claim organization page' })
    expect(form).toHaveAttribute('data-mode', 'claim')
    expect(form).toHaveAttribute('data-company', claimable.id)
    expect(form).toHaveAttribute('data-name', 'Harbour Crew')
    expect(screen.getByRole('link', { name: /Back to Harbour Crew/ })).toHaveAttribute('href', '/organizations/harbour-crew')
  })

  it('shows the review status instead of the form while the member\'s claim is reviewed', async () => {
    mocks.getUserOrganizationState.mockResolvedValue({
      kind: 'application', status: 'pending', applicationId: 'a', company: { id: claimable.id, slug: 'harbour-crew', name: 'Harbour Crew', verified: false },
    })
    render(await ClaimOrganizationPage({ params }))

    expect(screen.queryByRole('form')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Sea N Shore is reviewing your claim' })).toBeInTheDocument()
  })

  it('sends claimed pages back to the organization page and unknown pages to not found', async () => {
    mocks.getClaimableOrganization.mockResolvedValueOnce({ ...claimable, unclaimed: false })
    await expect(ClaimOrganizationPage({ params })).rejects.toThrow('NEXT_REDIRECT:/organizations/harbour-crew')

    mocks.getClaimableOrganization.mockResolvedValueOnce(null)
    await expect(ClaimOrganizationPage({ params })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

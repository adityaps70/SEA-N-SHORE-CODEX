import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiringApplicationReview } from '@/features/jobs/hiring-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getApplicationReview: vi.fn(),
  getDocument: vi.fn(),
  getRelationshipState: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/hiring/applicants/x' }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: vi.fn().mockResolvedValue(null) }))
vi.mock('@/features/jobs/hiring-repository', () => ({ hiringRepository: { getApplicationReview: mocks.getApplicationReview } }))
vi.mock('@/features/jobs/hiring-actions', () => ({ updateHiringApplicationStatus: vi.fn(), saveHiringRecruiterNote: vi.fn() }))
vi.mock('@/features/profiles/profile-document-repository', () => ({ profileDocumentRepository: { getDocument: mocks.getDocument } }))
vi.mock('@/features/network/queries', () => ({ getRelationshipState: mocks.getRelationshipState }))
vi.mock('@/features/messaging/actions', () => ({ startDirectConversationAction: vi.fn() }))

import HiringApplicantReviewPage from './page'

const applicationId = '33333333-3333-4333-8333-333333333333'

function review(): HiringApplicationReview {
  return {
    applicationId,
    status: 'under_review',
    appliedAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    coverNote: 'I have 14 months on AHTS.',
    cvAttachment: { storagePath: 'job-applications/c/j/cv.pdf', fileName: 'arjun.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
    match: { score: 88, reasons: ['Chief Officer rank'], missingRequirements: ['DP certificate'], warnings: [] },
    candidate: {
      id: 'candidate-1', slug: 'arjun', accountActive: true, fullName: 'Arjun Kapoor', avatarPath: null, location: 'Mumbai',
      headline: 'Chief Officer · LPG carriers', rank: 'Chief Officer', sailingExperienceYears: 11, vesselTypes: ['LPG'], tradingAreas: [],
      availability: null, shoreCareerPreference: false, skills: [], certificates: [], visas: [],
    },
    job: {
      id: 'job-1', title: 'Chief Officer — Offshore (AHTS)', companyName: 'Star Sea', companyId: 'company-1', companySlug: 'star-sea',
      companyLogoPath: null, companyLocation: 'Dubai', companyVerified: true, recruiterVerified: false, location: 'UAE', summary: 'AHTS role',
      description: 'd', requirements: null, applyUntil: null, createdAt: '2026-09-01T00:00:00.000Z', publishedAt: '2026-09-01T00:00:00.000Z',
      domain: 'sea', department: null, rank: 'Chief Officer', vesselTypes: ['AHTS'], experienceMinYears: null, experienceMaxYears: null,
      joiningFrom: null, joiningUntil: null, salaryMin: null, salaryMax: null, salaryCurrency: null, salaryPeriod: null, regions: [],
      certificateRequirements: [], visaRequirements: [], urgent: false, easyApply: true,
    },
    jobStatus: 'published',
    events: [],
    recruiterNotes: [],
  }
}

async function renderPage() {
  render(await HiringApplicantReviewPage({ params: Promise.resolve({ applicationId }) }))
}

afterEach(() => cleanup())

describe('applicant review page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'recruiter-1' })
    mocks.getApplicationReview.mockResolvedValue(review())
    mocks.getDocument.mockResolvedValue({ fileName: 'dg.pdf' })
    mocks.getRelationshipState.mockResolvedValue({ following: false, connection: { kind: 'connected', connectionId: 'c-1' } })
  })

  it('gives phones a page bar, match / CV / DG chips and the sticky Reject · … · Shortlist bar', async () => {
    await renderPage()

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/hiring/jobs/job-1/applicants')
    expect(screen.getByRole('button', { name: 'More applicant actions' })).toBeInTheDocument()
    const chips = screen.getByLabelText('Applicant highlights')
    expect(within(chips).getByText('88% match')).toBeInTheDocument()
    expect(within(chips).getByRole('link', { name: 'CV (PDF)' })).toHaveAttribute('href', `/api/jobs/applications/${applicationId}/cv`)
    expect(within(chips).getByRole('link', { name: 'DG profile' })).toBeInTheDocument()

    const bar = screen.getByTestId('applicant-decision-bar')
    expect(within(bar).getByRole('button', { name: 'Reject' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'More status options' })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: 'Shortlist' })).toBeInTheDocument()

    // Desktop status card and vacancy recap are kept for md and wider.
    expect(screen.getByText('Application status').closest('div.max-md\\:hidden')).not.toBeNull()
    expect(screen.getByText('Vacancy').closest('section')?.className).toContain('max-md:hidden')
  })

  it('lets the recruiter message a connected applicant', async () => {
    await renderPage()
    expect(mocks.getRelationshipState).toHaveBeenCalledWith('candidate-1')
    expect(within(screen.getByTestId('message-applicant')).getByRole('button', { name: 'Message' })).toBeEnabled()
  })

  it('explains why Message is unavailable before they are connected', async () => {
    mocks.getRelationshipState.mockResolvedValue({ following: false, connection: { kind: 'none', connectionId: null } })
    await renderPage()
    const button = within(screen.getByTestId('message-applicant')).getByRole('button', { name: 'Message' })
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleDescription(/Connect with Arjun Kapoor to message them/)
  })
})

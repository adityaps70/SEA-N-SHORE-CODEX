import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HiringApplicant, ManagedHiringJobSummary } from '@/features/jobs/hiring-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listManagedJobs: vi.fn(),
  listApplicants: vi.fn(),
  createMediaReadUrl: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error('NEXT_NOT_FOUND')
  }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, usePathname: () => '/hiring/jobs' }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: mocks.createMediaReadUrl }))
vi.mock('@/features/jobs/hiring-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/jobs/hiring-repository')>()
  return {
    ...original,
    hiringRepository: { listManagedJobs: mocks.listManagedJobs, listApplicants: mocks.listApplicants },
  }
})

import HiringApplicantsPage from './page'

const jobId = '22222222-2222-4222-8222-222222222222'

function managedJob(overrides: Partial<ManagedHiringJobSummary> = {}): ManagedHiringJobSummary {
  return {
    id: jobId,
    title: 'Chief Officer',
    status: 'published',
    domain: 'sea',
    rank: 'Chief Officer',
    vesselTypes: ['Oil Tanker'],
    location: 'Worldwide',
    urgent: false,
    applyUntil: null,
    publishedAt: '2026-09-01T00:00:00.000Z',
    applicantCount: 2,
    companyId: '11111111-1111-4111-8111-111111111111',
    publisherName: 'Oceanic Shipping',
    companySlug: 'oceanic',
    companyLogoPath: 'companies/oceanic/logo.png',
    companyLocation: 'Dubai',
    companyVerified: true,
    joiningUntil: null,
    createdAt: '2026-09-01T00:00:00.000Z',
    archivedAt: null,
    newApplicantCount: 1,
    moderationRemoved: false,
    canDelete: true,
    ...overrides,
  }
}

function applicant(overrides: Omit<Partial<HiringApplicant>, 'candidate'> & { candidate?: Partial<HiringApplicant['candidate']> } = {}): HiringApplicant {
  const { candidate, ...rest } = overrides
  return {
    applicationId: '33333333-3333-4333-8333-333333333333',
    status: 'applied',
    appliedAt: '2026-09-20T10:00:00.000Z',
    updatedAt: '2026-09-20T10:00:00.000Z',
    coverNote: 'Available from 1 November, currently on leave.',
    cvAttachment: { storagePath: 'job-applications/c-1/job/cv.pdf', fileName: 'rahul.pdf', mimeType: 'application/pdf', sizeBytes: 2048 },
    match: { score: 86, reasons: ['Current rank matches Chief Officer'], missingRequirements: [], warnings: [] },
    candidate: {
      id: 'candidate-1',
      slug: 'capt-rahul',
      accountActive: true,
      fullName: 'Capt Rahul Mehta',
      avatarPath: 'profiles/candidate-1/avatar.webp',
      location: 'Mumbai',
      headline: 'Chief Officer · Oil tankers',
      rank: 'Chief Officer',
      sailingExperienceYears: 11,
      vesselTypes: ['Oil Tanker'],
      tradingAreas: [],
      availability: 'Available',
      shoreCareerPreference: false,
      skills: [],
      certificates: [],
      visas: [],
      ...candidate,
    },
    ...rest,
  }
}

async function renderPage(search: Record<string, string> = {}) {
  render(await HiringApplicantsPage({ params: Promise.resolve({ jobId }), searchParams: Promise.resolve(search) }))
}

afterEach(() => cleanup())

describe('Hiring applicants page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'recruiter-1' })
    mocks.listManagedJobs.mockResolvedValue([managedJob()])
    mocks.createMediaReadUrl.mockResolvedValue('https://signed.example.test/avatar.webp')
    mocks.listApplicants.mockResolvedValue([
      applicant(),
      applicant({
        applicationId: '44444444-4444-4444-8444-444444444444',
        status: 'selected',
        coverNote: null,
        cvAttachment: null,
        candidate: { id: 'candidate-2', slug: null, accountActive: false, fullName: 'Former Sea N Shore member', avatarPath: null, headline: null },
      }),
    ])
  })

  it('shows the organization, each applicant with photo, profile link, date, status, message, CV and review link', async () => {
    await renderPage()

    expect(screen.getByRole('link', { name: 'Oceanic Shipping' })).toHaveAttribute('href', '/organizations/oceanic')
    expect(screen.getByRole('img', { name: 'Oceanic Shipping logo' })).toHaveAttribute('src', '/api/company-logo/11111111-1111-4111-8111-111111111111')
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Applicants · Chief Officer')

    const list = screen.getByRole('region', { name: 'Applicants' })
    const [first, second] = within(list).getAllByRole('article')
    expect(within(first!).getByRole('img', { name: 'Photo of Capt Rahul Mehta' })).toHaveAttribute('src', 'https://signed.example.test/avatar.webp')
    expect(within(first!).getByRole('link', { name: 'Capt Rahul Mehta' })).toHaveAttribute('href', '/people/capt-rahul')
    expect(within(first!).getByText('New')).toBeVisible()
    expect(within(first!).getByText(/^Applied .*2026$/)).toBeVisible()
    expect(within(first!).getByText('Available from 1 November, currently on leave.')).toBeVisible()
    expect(within(first!).getByRole('link', { name: 'CV attached' })).toHaveAttribute('href', '/api/jobs/applications/33333333-3333-4333-8333-333333333333/cv')
    expect(within(first!).getByRole('link', { name: 'Review application' })).toHaveAttribute('href', '/hiring/applicants/33333333-3333-4333-8333-333333333333')

    expect(within(second!).getByText('Hired')).toBeVisible()
    expect(within(second!).getByText('No CV attached')).toBeVisible()
    expect(within(second!).queryByRole('link', { name: 'Former Sea N Shore member' })).toBeNull()
    expect(within(second!).getByText(/account is no longer active/)).toBeVisible()
  })

  it('filters by stage with counts using the owner-facing stage names', async () => {
    await renderPage({ status: 'selected' })
    const filters = screen.getByRole('navigation', { name: 'Filter applicants by status' })
    expect(within(filters).getByRole('link', { name: 'All 2' })).toBeVisible()
    expect(within(filters).getByRole('link', { name: 'New 1' })).toBeVisible()
    expect(within(filters).getByRole('link', { name: 'Hired 1' })).toHaveAttribute('aria-current', 'page')
    expect(within(screen.getByRole('region', { name: 'Applicants' })).getAllByRole('article')).toHaveLength(1)
  })

  it('explains a job with no applicants yet, by job state', async () => {
    mocks.listApplicants.mockResolvedValue([])
    mocks.listManagedJobs.mockResolvedValue([managedJob({ status: 'draft', applicantCount: 0 })])
    await renderPage()
    expect(screen.getByRole('heading', { name: 'No applicants yet' })).toBeVisible()
    expect(screen.getByText(/still a draft\. Publish it to start receiving applications/)).toBeVisible()
    expect(screen.queryByRole('navigation', { name: 'Filter applicants by status' })).toBeNull()
  })

  it('returns not found for a job the viewer cannot manage', async () => {
    mocks.listManagedJobs.mockResolvedValue([])
    await expect(HiringApplicantsPage({ params: Promise.resolve({ jobId }), searchParams: Promise.resolve({}) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.listApplicants).not.toHaveBeenCalled()
  })
})

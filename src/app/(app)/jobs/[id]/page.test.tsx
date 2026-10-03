import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobListing } from '@/features/jobs/types'

const mocks = vi.hoisted(() => ({
  getJobDetailState: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/jobs/x' }))
vi.mock('@/features/jobs/queries', () => ({ getJobDetailState: mocks.getJobDetailState }))
vi.mock('@/features/jobs/actions', () => ({ applyToJob: vi.fn(), prepareJobApplicationCvUpload: vi.fn(), saveJob: vi.fn(), unsaveJob: vi.fn() }))
vi.mock('@/features/moderation/components/report-content-button', () => ({ ReportContentButton: ({ label }: { label: string }) => <button type="button">{label}</button> }))
vi.mock('@/components/navigation/rail-footer', () => ({ RailFooter: () => null }))

import JobDetailPage from './page'

const job: JobListing = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Chief Officer — Offshore (AHTS)',
  companyName: 'Star Sea Management',
  companyId: '22222222-2222-4222-8222-222222222222',
  companySlug: 'star-sea',
  companyLogoPath: null,
  companyVerified: true,
  recruiterVerified: false,
  location: 'United Arab Emirates',
  summary: 'AHTS vessel in the Arabian Gulf.',
  description: 'We are looking for an experienced Chief Officer. '.repeat(10).trim(),
  requirements: null,
  applyUntil: null,
  createdAt: '2026-09-21T10:00:00.000Z',
  publishedAt: '2026-09-21T10:00:00.000Z',
  domain: 'sea',
  department: 'Deck',
  rank: 'Chief Officer',
  vesselTypes: ['AHTS'],
  experienceMinYears: null,
  experienceMaxYears: null,
  joiningFrom: null,
  joiningUntil: null,
  salaryMin: null,
  salaryMax: null,
  salaryCurrency: null,
  salaryPeriod: null,
  regions: [],
  certificateRequirements: [],
  visaRequirements: [],
  urgent: true,
  easyApply: true,
}

afterEach(() => cleanup())

describe('job detail page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getJobDetailState.mockResolvedValue({
      job,
      alreadyApplied: false,
      isSaved: false,
      match: { score: 82, reasons: ['Rank matches', 'AHTS experience', 'Region'], missingRequirements: ['DP certificate'], warnings: ['Visa'] },
      profileReady: true,
    })
  })

  it('gives phones a page bar with the "…" menu, a one-line match row and the Save / Easy Apply bar', async () => {
    render(await JobDetailPage({ params: Promise.resolve({ id: job.id }) }))

    expect(screen.getByRole('link', { name: 'Back' })).toHaveAttribute('href', '/jobs')
    expect(screen.getByRole('button', { name: 'More job actions' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Strong match · 82%.*3 things match · 2 to check/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '…more' })).toBeInTheDocument()

    const bar = screen.getByTestId('job-apply-bar')
    expect(bar.className).toContain('sticky bottom-[calc(4.5rem+env(safe-area-inset-bottom))]')
    expect(bar.className).toContain('md:hidden')
    expect(within(bar).getByRole('button', { name: /Save/ })).toBeInTheDocument()
    expect(within(bar).getByRole('button', { name: /Easy Apply/ })).toBeInTheDocument()
  })

  it('keeps the desktop match section and adds Share and Copy link to the desktop apply card', async () => {
    render(await JobDetailPage({ params: Promise.resolve({ id: job.id }) }))

    expect(screen.getByRole('heading', { name: 'Your Maritime Match' }).closest('section')?.className).toContain('max-md:hidden')
    const applyCard = screen.getByText('Apply with Sea N Shore').parentElement!
    expect(applyCard.className).toContain('max-md:hidden')
    expect(within(applyCard).getByRole('button', { name: 'Share' })).toBeInTheDocument()
    expect(within(applyCard).getByRole('button', { name: 'Copy link' })).toBeInTheDocument()
    // Posted by and Report stay reachable on phones.
    expect(screen.getByRole('heading', { name: 'Posted by' }).closest('section')?.className).not.toContain('max-md:hidden')
    expect(screen.getByRole('button', { name: 'Report this job' })).toBeInTheDocument()
  })
})

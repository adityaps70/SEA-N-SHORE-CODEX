import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobListing } from '@/features/jobs/types'
import { parseJobSearchParams } from '@/features/jobs/search'

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  getJobsDiscovery: vi.fn(),
  getSignedOutJobsDiscovery: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/jobs',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/jobs/queries', () => ({ getJobsDiscovery: mocks.getJobsDiscovery, getSignedOutJobsDiscovery: mocks.getSignedOutJobsDiscovery }))
vi.mock('@/features/jobs/actions', () => ({ applyToJob: vi.fn(), prepareJobApplicationCvUpload: vi.fn(), saveJob: vi.fn(), unsaveJob: vi.fn() }))
vi.mock('@/features/signals/actions', () => ({ dismissSuggestionAction: vi.fn(), undoDismissSuggestionAction: vi.fn() }))

import JobsPage, { metadata } from './page'

const job: JobListing = {
  id: '11111111-1111-4111-8111-111111111111',
  title: 'Second Engineer — Bulk Carrier',
  companyName: 'Harbour Line Shipping',
  companyId: '22222222-2222-4222-8222-222222222222',
  companySlug: 'harbour-line',
  companyLogoPath: 'companies/22222222-2222-4222-8222-222222222222/logo.webp',
  companyVerified: true,
  recruiterVerified: false,
  location: 'Singapore',
  summary: 'Supramax bulk carrier, 6 month contract.',
  description: 'Engine room watchkeeping and maintenance.',
  requirements: null,
  applyUntil: null,
  createdAt: '2026-10-01T10:00:00.000Z',
  publishedAt: '2026-10-01T10:00:00.000Z',
  domain: 'sea',
  department: 'Engine',
  rank: 'Second Engineer',
  vesselTypes: ['Bulk Carrier'],
  experienceMinYears: 2,
  experienceMaxYears: null,
  joiningFrom: null,
  joiningUntil: null,
  salaryMin: 7000,
  salaryMax: 8000,
  salaryCurrency: 'USD',
  salaryPeriod: 'month',
  regions: [],
  certificateRequirements: [],
  visaRequirements: [],
  urgent: false,
  easyApply: true,
}

afterEach(() => cleanup())

describe('jobs list signed out (round H, H5)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVerifiedUser.mockResolvedValue(null)
    mocks.getSignedOutJobsDiscovery.mockResolvedValue({
      filters: { ...parseJobSearchParams({}), sort: 'recent' },
      items: [{ job, isSaved: false, alreadyApplied: false, match: null, gateMatch: null }],
      profileReady: false,
      version: 1,
      page: 1,
      hasMore: false,
      applied: [],
    })
  })

  it('lists live jobs without match data, with Save and Easy Apply linking to sign-in and back to the job', async () => {
    const { container } = render(await JobsPage({ searchParams: Promise.resolve({}) }))

    expect(mocks.getJobsDiscovery).not.toHaveBeenCalled()
    expect(mocks.getSignedOutJobsDiscovery).toHaveBeenCalledWith({})
    expect(screen.getAllByRole('link', { name: job.title }).length).toBeGreaterThan(0)
    expect(container.querySelector('[data-job-match]')).toBeNull()
    expect(screen.queryByText(/Your match/)).toBeNull()
    expect(screen.queryByText(/Complete your Maritime Passport/)).toBeNull()
    expect(screen.queryByText('Top picks for you')).toBeNull()
    expect(screen.getByText('Latest jobs')).toBeInTheDocument()
    // The signed-in workspace links (Saved, Applications, Alerts, My jobs) are not offered.
    expect(screen.queryByRole('navigation', { name: 'Jobs workspace' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'My jobs' })).toBeNull()
    expect(screen.getAllByRole('link', { name: 'All jobs' }).length).toBeGreaterThan(0)

    const signIn = `/auth/sign-in?next=${encodeURIComponent(`/jobs/${job.id}`)}`
    expect(screen.getAllByRole('link', { name: /Save/ }).every((link) => link.getAttribute('href') === signIn)).toBe(true)
    expect(screen.getByRole('link', { name: /Easy Apply/ })).toHaveAttribute('href', signIn)
    expect(screen.queryByRole('button', { name: /Save|Easy Apply|Not interested/ })).toBeNull()
    // A verified employer's logo is public (see /api/company-logo); the fixture employer is verified.
    expect(job.companyVerified).toBe(true)
    expect(container.querySelector('img[src^="/api/company-logo/"]')).not.toBeNull()
  })

  it('shows an unverified employer as the initials tile, since its logo is for members only', async () => {
    mocks.getSignedOutJobsDiscovery.mockResolvedValueOnce({
      filters: { ...parseJobSearchParams({}), sort: 'recent' },
      items: [{ job: { ...job, companyVerified: false }, isSaved: false, alreadyApplied: false, match: null, gateMatch: null }],
      profileReady: false,
      version: 1,
      page: 1,
      hasMore: false,
      applied: [],
    })
    const { container } = render(await JobsPage({ searchParams: Promise.resolve({}) }))
    expect(container.querySelector('img[src^="/api/company-logo/"]')).toBeNull()
  })

  it('is indexable with /jobs as its canonical address and a plain description', () => {
    expect(metadata.alternates?.canonical).toBe('/jobs')
    expect(metadata.robots).toBeUndefined()
    const description = String(metadata.description)
    expect(description.length).toBeLessThanOrEqual(160)
    expect(description).not.toMatch(/\n/)
  })
})

describe('jobs list signed in', () => {
  it('keeps the personalised list for members', async () => {
    vi.clearAllMocks()
    mocks.getVerifiedUser.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' })
    mocks.getJobsDiscovery.mockResolvedValue({
      filters: parseJobSearchParams({}),
      items: [{ job, isSaved: false, alreadyApplied: false, match: { score: 82, reasons: ['Rank matches'], missingRequirements: [], warnings: [] } }],
      profileReady: true,
      version: 1,
      page: 1,
      hasMore: false,
      applied: [],
    })
    render(await JobsPage({ searchParams: Promise.resolve({}) }))

    expect(mocks.getSignedOutJobsDiscovery).not.toHaveBeenCalled()
    expect(screen.getByRole('navigation', { name: 'Jobs workspace' })).toBeInTheDocument()
    expect(screen.getByText('Top picks for you')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /Save/ }).length).toBeGreaterThan(0)
  })

  it('labels Recently Posted "Newest first" (not Recommended), and its chips keep the search and filters (bug fix, 13 Nov)', async () => {
    vi.clearAllMocks()
    mocks.getVerifiedUser.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' })
    const params = { mode: 'recent', q: 'engineer', department: 'engine_officers' }
    mocks.getJobsDiscovery.mockResolvedValue({
      filters: parseJobSearchParams(params),
      items: [{ job, isSaved: false, alreadyApplied: false, match: null }],
      profileReady: true,
      version: 2,
      page: 1,
      hasMore: false,
      applied: [],
    })
    render(await JobsPage({ searchParams: Promise.resolve(params) }))

    expect(screen.getByText('Recently posted')).toBeInTheDocument()
    expect(screen.queryByText('Jobs for you')).not.toBeInTheDocument()
    expect(screen.getByText('Sort by: Newest first')).toBeInTheDocument()
    expect(screen.queryByText(/Sort by: Recommended/)).not.toBeInTheDocument()
    // The desktop chip row (the phone row reads the URL in the browser).
    const urgent = screen.getAllByRole('link', { name: 'Urgent Joining' }).map((link) => link.getAttribute('href'))
    expect(urgent).toContain('/jobs?mode=urgent&q=engineer&department=engine_officers')
    const current = screen.getAllByRole('link', { name: 'Recently Posted' }).filter((link) => link.getAttribute('aria-current') === 'page')
    expect(current.length).toBeGreaterThan(0)
    expect(within(document.body).queryAllByRole('button', { name: 'Not interested' })).toHaveLength(0)
  })
})

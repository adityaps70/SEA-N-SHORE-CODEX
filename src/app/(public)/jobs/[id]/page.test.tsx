import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobListing } from '@/features/jobs/types'

const mocks = vi.hoisted(() => ({
  getJobDetailState: vi.fn(),
  getSignedOutJobDetailState: vi.fn(),
  getJobPageExtras: vi.fn(),
  getVerifiedUser: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => '/jobs/x' }))
vi.mock('@/features/jobs/queries', () => ({ getJobDetailState: mocks.getJobDetailState, getSignedOutJobDetailState: mocks.getSignedOutJobDetailState, getJobPageExtras: mocks.getJobPageExtras }))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/jobs/actions', () => ({ applyToJob: vi.fn(), prepareJobApplicationCvUpload: vi.fn(), saveJob: vi.fn(), unsaveJob: vi.fn() }))
vi.mock('@/features/moderation/components/report-content-button', () => ({ ReportContentButton: ({ label }: { label: string }) => <button type="button">{label}</button> }))
vi.mock('@/components/navigation/rail-footer', () => ({ RailFooter: () => null }))

import JobDetailPage, { generateMetadata } from './page'

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

beforeEach(() => {
  // Round H (H7): the applicant range and similar jobs load for every visitor.
  mocks.getJobPageExtras.mockResolvedValue({ applicantCount: 0, similarJobs: [] })
})

describe('job detail page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVerifiedUser.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' })
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

function jobPosting(container: HTMLElement) {
  const script = container.querySelector('script[type="application/ld+json"]')
  expect(script).not.toBeNull()
  return JSON.parse(script!.textContent ?? '{}') as Record<string, unknown>
}

describe('job detail page signed out (round H, H5)', () => {
  const signInHref = `/auth/sign-in?next=${encodeURIComponent(`/jobs/${job.id}`)}`

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVerifiedUser.mockResolvedValue(null)
    mocks.getSignedOutJobDetailState.mockResolvedValue({ job, alreadyApplied: false, isSaved: false, match: null, gateMatch: null, profileReady: false })
  })

  it('renders the job without a match, with Apply, Save and Report linking to sign-in and back', async () => {
    render(await JobDetailPage({ params: Promise.resolve({ id: job.id }) }))

    expect(mocks.getJobDetailState).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1, name: job.title })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Your Maritime Match' })).toBeNull()
    expect(screen.queryByText(/Maritime Passport\b.*fit score/)).toBeNull()

    const applyCard = screen.getByText('Apply with Sea N Shore').parentElement!
    expect(within(applyCard).getByRole('link', { name: /Apply now/ })).toHaveAttribute('href', signInHref)
    expect(within(applyCard).getByRole('link', { name: /Save/ })).toHaveAttribute('href', signInHref)
    const bar = screen.getByTestId('job-apply-bar')
    expect(within(bar).getByRole('link', { name: /Easy Apply/ })).toHaveAttribute('href', signInHref)
    expect(within(bar).getByRole('link', { name: /Save/ })).toHaveAttribute('href', signInHref)
    // No bottom tabs for visitors: the phone bar sits at the bottom edge.
    expect(bar.className).toContain('bottom-0')
    expect(screen.getByRole('link', { name: 'Report this job' })).toHaveAttribute('href', signInHref)
    expect(screen.queryByRole('button', { name: /Easy Apply|Apply now|Save|Report this job/ })).toBeNull()
  })

  it('carries a valid schema.org JobPosting', async () => {
    const { container } = render(await JobDetailPage({ params: Promise.resolve({ id: job.id }) }))
    const data = jobPosting(container)

    expect(data['@context']).toBe('https://schema.org')
    expect(data['@type']).toBe('JobPosting')
    expect(data.title).toBe(job.title)
    expect(typeof data.description).toBe('string')
    expect(data.description).toContain('AHTS vessel in the Arabian Gulf.')
    expect(data.datePosted).toBe(job.publishedAt)
    expect(data.employmentType).toBe('TEMPORARY')
    expect(data.directApply).toBe(true)
    expect(data.hiringOrganization).toEqual({ '@type': 'Organization', name: job.companyName, sameAs: 'http://localhost:3000/organizations/star-sea' })
    expect(data.jobLocation).toEqual({ '@type': 'Place', address: { '@type': 'PostalAddress', addressCountry: 'AE' } })
    expect(data.url).toBe(`http://localhost:3000/jobs/${job.id}`)
  })

  it('gives members the same JobPosting', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' })
    mocks.getJobDetailState.mockResolvedValue({ job, alreadyApplied: false, isSaved: false, match: null, gateMatch: null, profileReady: true })
    const { container } = render(await JobDetailPage({ params: Promise.resolve({ id: job.id }) }))
    expect(jobPosting(container).title).toBe(job.title)
    expect(screen.getByRole('button', { name: 'Report this job' })).toBeInTheDocument()
  })

  it('is indexable with a canonical address while open, and noindex with a past validThrough once closed', async () => {
    const open = await generateMetadata({ params: Promise.resolve({ id: job.id }) })
    expect(open.alternates?.canonical).toBe(`/jobs/${job.id}`)
    expect(open.robots).toBeUndefined()
    expect(open.title).toBe(`${job.title} at ${job.companyName}`)
    expect(String(open.description)).toBe('AHTS vessel in the Arabian Gulf.')

    const expired = { ...job, applyUntil: '2026-01-31' }
    mocks.getSignedOutJobDetailState.mockResolvedValue({ job: expired, alreadyApplied: false, isSaved: false, match: null, gateMatch: null, profileReady: false })
    const closed = await generateMetadata({ params: Promise.resolve({ id: job.id }) })
    expect(closed.robots).toEqual({ index: false, follow: true })

    const { container } = render(await JobDetailPage({ params: Promise.resolve({ id: job.id }) }))
    expect(jobPosting(container).validThrough).toBe('2026-01-31T23:59:59Z')
    expect(screen.getByText(/Applications for this job closed/)).toBeInTheDocument()
  })

  it('is not found (404) when the job is closed or deleted, or the id is not a job id', async () => {
    mocks.getSignedOutJobDetailState.mockResolvedValue({ job: null, alreadyApplied: false, isSaved: false, match: null, gateMatch: null, profileReady: false })
    await expect(JobDetailPage({ params: Promise.resolve({ id: job.id }) })).rejects.toThrow('NEXT_NOT_FOUND')
    await expect(JobDetailPage({ params: Promise.resolve({ id: 'saved-search' }) })).rejects.toThrow('NEXT_NOT_FOUND')
    expect(mocks.getSignedOutJobDetailState).toHaveBeenCalledTimes(1)
  })
})

describe('job detail page facts, checks and similar jobs (round H, H7)', () => {
  const similar: JobListing = { ...job, id: '44444444-4444-4444-8444-444444444444', title: 'Chief Officer — PSV', companyName: 'Placeholder Offshore', salaryMin: 240, salaryMax: 240, salaryCurrency: 'USD', salaryPeriod: 'day' }

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getVerifiedUser.mockResolvedValue(null)
    mocks.getSignedOutJobDetailState.mockResolvedValue({
      job: { ...job, salaryMin: 3_900_000, salaryMax: 5_000_000, salaryCurrency: 'INR', salaryPeriod: 'year' },
      alreadyApplied: false, isSaved: false, match: null, gateMatch: null, profileReady: false,
    })
    mocks.getJobPageExtras.mockResolvedValue({ applicantCount: 12, similarJobs: [similar] })
  })

  it('shows signed-out visitors the posted date, the applicant range and the salary in LPA', async () => {
    render(await JobDetailPage({ params: Promise.resolve({ id: job.id }) }))

    const line = screen.getByTestId('job-posted-line')
    expect(line.className).not.toContain('md:hidden')
    expect(line).toHaveTextContent(/^Posted .+ · 10–25 applicants$/)
    expect(within(line).getByText(/^Posted/).tagName).toBe('TIME')
    expect(screen.getByText('₹39–50 LPA')).toBeInTheDocument()
    expect(mocks.getJobPageExtras).toHaveBeenCalledWith(expect.objectContaining({ id: job.id }))
  })

  it('says "Be among the first applicants" when nobody has applied', async () => {
    mocks.getJobPageExtras.mockResolvedValue({ applicantCount: 0, similarJobs: [] })
    render(await JobDetailPage({ params: Promise.resolve({ id: job.id }) }))
    expect(screen.getByTestId('job-posted-line')).toHaveTextContent('Be among the first applicants')
    expect(screen.queryByRole('heading', { name: 'Similar jobs' })).toBeNull()
  })

  it('lists similar jobs as compact cards linking to each job', async () => {
    render(await JobDetailPage({ params: Promise.resolve({ id: job.id }) }))

    const section = screen.getByRole('heading', { name: 'Similar jobs' }).closest('section')!
    expect(within(section).getByRole('link', { name: similar.title })).toHaveAttribute('href', `/jobs/${similar.id}`)
    expect(within(section).getByText(/\$240\/day/)).toBeInTheDocument()
  })

  it('explains each check on phones and desktop: what is required and what the profile has', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: '33333333-3333-4333-8333-333333333333' })
    mocks.getJobDetailState.mockResolvedValue({
      job,
      alreadyApplied: false,
      isSaved: false,
      match: {
        score: 55,
        reasons: ['AHTS experience'],
        missingRequirements: ['COC: Master', '5+ years experience'],
        warnings: [],
        checks: [
          { key: 'certificate', label: 'Certificate', required: 'COC: Master', yours: 'COC: Chief Mate' },
          { key: 'experience', label: 'Sea time', required: '5+ years', yours: '3 years' },
        ],
      },
      profileReady: true,
    })
    render(await JobDetailPage({ params: Promise.resolve({ id: job.id }) }))

    const phone = screen.getByRole('heading', { level: 2, name: 'Check before applying' }).closest('section')!
    expect(phone.className).toContain('md:hidden')
    expect(phone.className).not.toContain('max-md:hidden')
    expect(within(phone).getByText('Required: COC: Master')).toBeInTheDocument()
    expect(within(phone).getByText('Your profile: COC: Chief Mate')).toBeInTheDocument()
    expect(within(phone).getByText('Required: 5+ years')).toBeInTheDocument()
    expect(within(phone).getByText('Your profile: 3 years')).toBeInTheDocument()

    const desktop = screen.getByRole('heading', { name: 'Your Maritime Match' }).closest('section')!
    expect(within(desktop).getByText('Your profile: COC: Chief Mate')).toBeInTheDocument()
  })
})

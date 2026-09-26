import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceCourse } from '@/features/learning/marketplace-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getMentorApplicationState: vi.fn(),
  getAccessContext: vi.fn(),
  listUserOrganizations: vi.fn(),
  listPublishedCourses: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ getAccessContext: mocks.getAccessContext }))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { listUserOrganizations: mocks.listUserOrganizations },
}))
vi.mock('@/features/learning/repository', () => ({
  learningRepository: {
    getMentorApplicationState: mocks.getMentorApplicationState,
  },
}))
vi.mock('@/features/learning/marketplace-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/learning/marketplace-repository')>()
  return {
    ...original,
    marketplaceRepository: {
      listPublishedCourses: mocks.listPublishedCourses,
    },
  }
})

import LearnPage from './page'

const course: MarketplaceCourse = {
  id: '11111111-1111-4111-8111-111111111111',
  mentorId: '22222222-2222-4222-8222-222222222222',
  mentorName: 'Capt. Maya Singh',
  slug: 'sire-2-readiness-for-tanker-officers',
  title: 'SIRE 2.0 Readiness for Tanker Officers',
  subtitle: 'Practical inspection readiness from a Master Mariner',
  description: 'A practical maritime course covering evidence-led SIRE 2.0 preparation, officer readiness and onboard execution.',
  category: 'SIRE 2.0',
  level: 'advanced',
  language: 'English',
  thumbnailPath: 'learning/courses/sire-2/thumbnail.jpg',
  trailerPath: 'learning/courses/sire-2/trailer.mp4',
  learningOutcomes: ['Prepare evidence for SIRE 2.0 interviews', 'Run an effective onboard readiness review'],
  requirements: ['Officer-level tanker experience'],
  targetAudience: ['Deck officers', 'Marine superintendents'],
  certificateEnabled: true,
  courseFormat: 'recorded',
  accessType: 'paid',
  priceMinor: 2_000_000,
  currency: 'INR',
  publishedAt: '2026-09-14T12:00:00.000Z',
}

type LearnPageSearch = {
  category?: string
  search?: string
}

type TestLearnPage = (props: {
  searchParams: Promise<LearnPageSearch>
}) => ReturnType<typeof LearnPage> | Promise<ReturnType<typeof LearnPage>>

async function renderLearnPage(searchParams: LearnPageSearch = {}) {
  const page = LearnPage as unknown as TestLearnPage
  render(await page({ searchParams: Promise.resolve(searchParams) }))
}

afterEach(() => {
  cleanup()
})

describe('/learn marketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'maya@example.com' })
    mocks.getMentorApplicationState.mockResolvedValue({ kind: 'none' })
    mocks.getAccessContext.mockResolvedValue({
      personalPlan: 'free',
      personalEntitlements: ['job.apply', 'event.attend', 'course.enroll'],
      verifications: [],
      organizationMemberships: [],
      accountActive: true,
    })
    mocks.listUserOrganizations.mockResolvedValue([])
    mocks.listPublishedCourses.mockResolvedValue([course])
  })

  it('renders real published courses from verified maritime trainers with their configured price', async () => {
    await renderLearnPage()

    expect(mocks.listPublishedCourses).toHaveBeenCalledWith({ category: null, search: null })
    expect(screen.getByRole('heading', { name: 'Learn from verified maritime professionals.' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search maritime courses' })).toHaveValue('')
    expect(screen.getByRole('link', { name: 'SIRE 2.0 Readiness for Tanker Officers' })).toHaveAttribute(
      'href',
      '/learn/courses/sire-2-readiness-for-tanker-officers',
    )
    expect(screen.getByText('Capt. Maya Singh')).toBeInTheDocument()
    expect(screen.getByText('Verified trainer')).toBeInTheDocument()
    expect(screen.getAllByText('SIRE 2.0')).toHaveLength(2)
    expect(screen.getByText('Advanced')).toBeInTheDocument()
    expect(screen.getByText('Recorded')).toBeInTheDocument()
    expect(screen.getByText('₹20,000')).toBeInTheDocument()
    expect(screen.queryByText('Free')).not.toBeInTheDocument()
    expect(screen.getByText('Certificate')).toBeInTheDocument()
    expect(screen.getByText('Prepare evidence for SIRE 2.0 interviews')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Trainer verification' })).toHaveAttribute('href', '/learn/teach')
  })

  it('replaces the teaching application CTA with Learning Studio for an approved active trainer', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({
      kind: 'mentor',
      applicationId: '33333333-3333-4333-8333-333333333333',
      status: 'approved',
      submittedAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T14:00:00.000Z',
      adminReviewNote: 'Approved after credential review.',
      mentorId: 'mentor-1',
      mentorStatus: 'active',
    })

    await renderLearnPage()

    expect(screen.getByRole('link', { name: 'Learning Studio' })).toHaveAttribute('href', '/learn/studio')
    expect(screen.queryByRole('link', { name: 'Trainer verification' })).not.toBeInTheDocument()
  })

  it('keeps the teaching application CTA when trainer verification is suspended', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({
      kind: 'mentor',
      applicationId: '33333333-3333-4333-8333-333333333333',
      status: 'approved',
      submittedAt: '2026-09-14T12:00:00.000Z',
      updatedAt: '2026-09-14T14:00:00.000Z',
      adminReviewNote: 'Access review in progress.',
      mentorId: 'mentor-1',
      mentorStatus: 'suspended',
    })

    await renderLearnPage()

    expect(screen.getByRole('link', { name: 'Trainer verification' })).toHaveAttribute('href', '/learn/teach')
    expect(screen.queryByRole('link', { name: 'Learning Studio' })).not.toBeInTheDocument()
  })

  it('passes normalized search and category filters into the published marketplace query', async () => {
    await renderLearnPage({ category: ' SIRE 2.0 ', search: ' tanker readiness ' })

    expect(mocks.listPublishedCourses).toHaveBeenCalledWith({
      category: 'SIRE 2.0',
      search: 'tanker readiness',
    })
    expect(screen.getByRole('searchbox', { name: 'Search maritime courses' })).toHaveValue('tanker readiness')
    expect(screen.getByRole('link', { name: 'SIRE 2.0' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/learn')
  })

  it('preserves the active text search when switching categories', async () => {
    await renderLearnPage({ search: 'leadership' })

    expect(screen.getByRole('link', { name: 'Leadership' })).toHaveAttribute(
      'href',
      '/learn?search=leadership&category=Leadership',
    )
  })

  it('shows a useful no-results state without inventing courses', async () => {
    mocks.listPublishedCourses.mockResolvedValueOnce([])

    await renderLearnPage({ category: 'LNG/LPG' })

    expect(screen.getByText('No published courses match these filters yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/learn')
    expect(screen.queryByText(course.title)).not.toBeInTheDocument()
  })
})
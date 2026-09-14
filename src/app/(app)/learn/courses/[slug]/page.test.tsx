import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceCourse } from '@/features/learning/marketplace-repository'

const mocks = vi.hoisted(() => ({
  getPublishedCourseBySlug: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('@/features/learning/marketplace-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/learning/marketplace-repository')>()
  return {
    ...original,
    marketplaceRepository: {
      getPublishedCourseBySlug: mocks.getPublishedCourseBySlug,
    },
  }
})

import PublishedCoursePage from './page'

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
  learningOutcomes: [
    'Prepare evidence for SIRE 2.0 interviews',
    'Run an effective onboard readiness review',
  ],
  requirements: ['Officer-level tanker experience', 'Working knowledge of tanker operations'],
  targetAudience: ['Deck officers', 'Marine superintendents'],
  certificateEnabled: true,
  courseFormat: 'recorded',
  accessType: 'free',
  priceMinor: 0,
  currency: 'INR',
  publishedAt: '2026-09-14T12:00:00.000Z',
}

afterEach(() => cleanup())

describe('/learn/courses/[slug]', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPublishedCourseBySlug.mockResolvedValue(course)
  })

  it('loads the published course by slug and presents its verified maritime learning evidence', async () => {
    render(await PublishedCoursePage({ params: Promise.resolve({ slug: course.slug }) }))

    expect(mocks.getPublishedCourseBySlug).toHaveBeenCalledWith(course.slug)
    expect(screen.getByRole('link', { name: 'Explore courses' })).toHaveAttribute('href', '/learn')
    expect(screen.getByRole('heading', { name: course.title })).toBeInTheDocument()
    expect(screen.getByText(course.subtitle!)).toBeInTheDocument()
    expect(screen.getByText(course.description)).toBeInTheDocument()
    expect(screen.getByText('Capt. Maya Singh')).toBeInTheDocument()
    expect(screen.getByText('Verified mentor')).toBeInTheDocument()
    expect(screen.getByText('SIRE 2.0')).toBeInTheDocument()
    expect(screen.getByText('Advanced')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('Recorded')).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('Certificate')).toBeInTheDocument()
  })

  it('renders all learning outcomes, requirements and intended learners without fake curriculum', async () => {
    render(await PublishedCoursePage({ params: Promise.resolve({ slug: course.slug }) }))

    const outcomes = screen.getByRole('region', { name: 'What you will learn' })
    expect(within(outcomes).getByText('Prepare evidence for SIRE 2.0 interviews')).toBeInTheDocument()
    expect(within(outcomes).getByText('Run an effective onboard readiness review')).toBeInTheDocument()

    const requirements = screen.getByRole('region', { name: 'Requirements' })
    expect(within(requirements).getByText('Officer-level tanker experience')).toBeInTheDocument()
    expect(within(requirements).getByText('Working knowledge of tanker operations')).toBeInTheDocument()

    const audience = screen.getByRole('region', { name: 'Who this course is for' })
    expect(within(audience).getByText('Deck officers')).toBeInTheDocument()
    expect(within(audience).getByText('Marine superintendents')).toBeInTheDocument()

    expect(screen.queryByText(/lesson 1/i)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /enroll/i })).not.toBeInTheDocument()
  })

  it('uses not found when the slug is not currently visible in the published marketplace', async () => {
    mocks.getPublishedCourseBySlug.mockResolvedValueOnce(null)

    await PublishedCoursePage({ params: Promise.resolve({ slug: 'missing-course' }) })

    expect(mocks.getPublishedCourseBySlug).toHaveBeenCalledWith('missing-course')
    expect(mocks.notFound).toHaveBeenCalledOnce()
  })
})

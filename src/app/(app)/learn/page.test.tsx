import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MarketplaceCourse } from '@/features/learning/marketplace-repository'

const mocks = vi.hoisted(() => ({
  listPublishedCourses: vi.fn(),
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
  accessType: 'free',
  priceMinor: 0,
  currency: 'INR',
  publishedAt: '2026-09-14T12:00:00.000Z',
}

afterEach(() => {
  cleanup()
})

describe('/learn marketplace', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.listPublishedCourses.mockResolvedValue([course])
  })

  it('renders real published courses from verified maritime mentors', async () => {
    render(await LearnPage({ searchParams: Promise.resolve({}) }))

    expect(mocks.listPublishedCourses).toHaveBeenCalledWith({ category: null, search: null })
    expect(screen.getByRole('heading', { name: 'Learn from verified maritime professionals.' })).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search maritime courses' })).toHaveValue('')
    expect(screen.getByRole('link', { name: 'SIRE 2.0 Readiness for Tanker Officers' })).toHaveAttribute(
      'href',
      '/learn/courses/sire-2-readiness-for-tanker-officers',
    )
    expect(screen.getByText('Capt. Maya Singh')).toBeInTheDocument()
    expect(screen.getByText('Verified mentor')).toBeInTheDocument()
    expect(screen.getByText('SIRE 2.0')).toBeInTheDocument()
    expect(screen.getByText('Advanced')).toBeInTheDocument()
    expect(screen.getByText('Recorded')).toBeInTheDocument()
    expect(screen.getByText('Free')).toBeInTheDocument()
    expect(screen.getByText('Certificate')).toBeInTheDocument()
    expect(screen.getByText('Prepare evidence for SIRE 2.0 interviews')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Teach on Sea N Shore' })).toHaveAttribute('href', '/learn/teach')
  })

  it('passes normalized search and category filters into the published marketplace query', async () => {
    render(await LearnPage({
      searchParams: Promise.resolve({ category: ' SIRE 2.0 ', search: ' tanker readiness ' }),
    }))

    expect(mocks.listPublishedCourses).toHaveBeenCalledWith({
      category: 'SIRE 2.0',
      search: 'tanker readiness',
    })
    expect(screen.getByRole('searchbox', { name: 'Search maritime courses' })).toHaveValue('tanker readiness')
    expect(screen.getByRole('link', { name: 'SIRE 2.0' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/learn')
  })

  it('preserves the active text search when switching categories', async () => {
    render(await LearnPage({ searchParams: Promise.resolve({ search: 'leadership' }) }))

    expect(screen.getByRole('link', { name: 'Leadership' })).toHaveAttribute(
      'href',
      '/learn?search=leadership&category=Leadership',
    )
  })

  it('shows a useful no-results state without inventing courses', async () => {
    mocks.listPublishedCourses.mockResolvedValueOnce([])

    render(await LearnPage({ searchParams: Promise.resolve({ category: 'LNG/LPG' }) }))

    expect(screen.getByText('No published courses match these filters yet.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Clear filters' })).toHaveAttribute('href', '/learn')
    expect(screen.queryByText(course.title)).not.toBeInTheDocument()
  })
})

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  canAccessPlatformAdmin: vi.fn(),
  load: vi.fn(),
  notFound: vi.fn(),
}))

vi.mock('next/navigation', () => ({ notFound: mocks.notFound }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/access', () => ({ canAccessPlatformAdmin: mocks.canAccessPlatformAdmin }))
vi.mock('@/lib/aws/storage', () => ({ createMediaReadUrl: vi.fn() }))
vi.mock('@/features/learning/course-revision-comparison', () => ({ courseRevisionComparisonRepository: { load: mocks.load } }))

import CourseRevisionChangesPage, { generateMetadata } from './page'

afterEach(() => cleanup())

const revisionId = '33333333-3333-4333-8333-333333333333'

const comparison = {
  revisionCourseId: revisionId,
  liveCourseId: '44444444-4444-4444-8444-444444444444',
  liveSlug: 'sire-2-readiness',
  title: 'SIRE 2.0 Readiness',
  status: 'draft',
  closed: false,
  changes: [{ area: 'material', change: 'changed', label: 'Inspection day', fields: ['article'] }],
  materials: [
    {
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Inspection day',
      sectionTitle: 'Module 1',
      status: 'changed',
      fields: ['article'],
      before: { title: 'Inspection day', summary: null, articleBody: 'INSPECTION DAY\nCheck the lines.', articleFormat: 'plain' },
      after: { title: 'Inspection day', summary: null, articleBody: '<h2>Inspection Day</h2><p>Check the lines.</p>', articleFormat: 'html' },
    },
    {
      id: '66666666-6666-4666-8666-666666666666',
      title: 'Mooring',
      sectionTitle: 'Module 2',
      status: 'changed',
      fields: ['article'],
      before: { title: 'Mooring', summary: null, articleBody: 'Check the lines.', articleFormat: 'plain' },
      after: { title: 'Mooring', summary: null, articleBody: 'Check the ropes.', articleFormat: 'plain' },
    },
  ],
}

describe('/learn/studio/courses/[courseId]/changes (round E)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'user-1' })
    mocks.canAccessPlatformAdmin.mockResolvedValue(true)
    mocks.load.mockResolvedValue(comparison)
  })

  it('shows each changed material, says when only the layout changed, and diffs the words', async () => {
    render(await CourseRevisionChangesPage({ params: Promise.resolve({ courseId: revisionId }) }))
    expect(mocks.load).toHaveBeenCalledWith('user-1', revisionId, { platformAdmin: true })
    expect(screen.getByRole('heading', { name: 'Draft changes' })).toBeInTheDocument()

    const converted = screen.getByRole('article', { name: 'Inspection day' })
    expect(within(converted).getByText('Same words. Only the layout and heading capitals change.')).toBeInTheDocument()
    expect(within(converted).getByText(/Plain text → rich text/)).toBeInTheDocument()

    const reworded = screen.getByRole('article', { name: 'Mooring' })
    expect(within(reworded).queryByText(/Same words/)).not.toBeInTheDocument()
    expect(reworded.querySelector('del')).toHaveTextContent('lines.')
    expect(reworded.querySelector('ins')).toHaveTextContent('ropes.')
  })

  it('names the tab after the course and refuses a course the person cannot see', async () => {
    await expect(generateMetadata({ params: Promise.resolve({ courseId: revisionId }) })).resolves.toEqual({ title: 'Draft changes · SIRE 2.0 Readiness' })
    mocks.load.mockResolvedValue(null)
    await CourseRevisionChangesPage({ params: Promise.resolve({ courseId: 'other' }) })
    expect(mocks.notFound).toHaveBeenCalled()
  })
})

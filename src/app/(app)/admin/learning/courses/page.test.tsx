import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseReviewItem } from '@/features/learning/admin-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  listCoursesForReview: vi.fn(),
}))

vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/admin-repository', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/features/learning/admin-repository')>()
  return {
    ...original,
    learningAdminRepository: {
      listCoursesForReview: mocks.listCoursesForReview,
    },
  }
})
vi.mock('@/features/learning/components/course-review-controls', () => ({
  CourseReviewControls: ({ courseId, status }: { courseId: string; status: string }) => (
    <div data-testid="course-review-controls">review:{courseId}:{status}</div>
  ),
}))

import LearningCoursesAdminPage from './page'

const course: CourseReviewItem = {
  courseId: '22222222-2222-4222-8222-222222222222',
  mentorId: '33333333-3333-4333-8333-333333333333',
  mentorUserId: 'mentor-user-1',
  mentorName: 'Capt. Maya Singh',
  slug: 'sire-2-readiness-for-tanker-officers',
  title: 'SIRE 2.0 Readiness for Tanker Officers',
  subtitle: 'Practical inspection readiness from a Master Mariner',
  description: 'A practical maritime course covering evidence-led SIRE 2.0 preparation, officer readiness and onboard execution.',
  category: 'SIRE 2.0',
  level: 'advanced',
  language: 'English',
  learningOutcomes: ['Prepare evidence for SIRE 2.0 interviews', 'Run an effective onboard readiness review'],
  requirements: ['Officer-level tanker experience'],
  targetAudience: ['Deck officers', 'Marine superintendents'],
  priceMinor: 0,
  discountPriceMinor: null,
  currency: 'INR',
  accessType: 'free',
  certificateEnabled: true,
  courseFormat: 'recorded',
  status: 'submitted',
  adminReviewNote: null,
  updatedAt: '2026-09-14T12:00:00.000Z',
  curriculum: [],
}

afterEach(() => {
  cleanup()
})

describe('/admin/learning/courses', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.requireAwsUser.mockResolvedValue({ id: 'admin-1', cognitoSub: 'admin-sub', email: 'admin@example.com' })
    mocks.listCoursesForReview.mockResolvedValue([course])
  })

  it('opens on the submitted course queue and surfaces maritime quality evidence', async () => {
    render(await LearningCoursesAdminPage({ searchParams: Promise.resolve({}) }))

    expect(mocks.listCoursesForReview).toHaveBeenCalledWith('admin-1', 'submitted')
    expect(screen.getByRole('heading', { name: 'Course review' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Trainer verifications' })).toHaveAttribute('href', '/admin/learning')
    expect(screen.getByRole('link', { name: 'Course review' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Analytics' })).toHaveAttribute('href', '/admin/learning/analytics')
    expect(screen.getByText(course.title)).toBeInTheDocument()
    expect(screen.getByText(course.subtitle!)).toBeInTheDocument()
    expect(screen.getByText('Capt. Maya Singh')).toBeInTheDocument()
    expect(screen.getByText('SIRE 2.0')).toBeInTheDocument()
    expect(screen.getByText('Advanced')).toBeInTheDocument()
    expect(screen.getByText('Recorded')).toBeInTheDocument()
    expect(screen.getByText('English')).toBeInTheDocument()
    expect(screen.getByText('Prepare evidence for SIRE 2.0 interviews')).toBeInTheDocument()
    expect(screen.getByText('Officer-level tanker experience')).toBeInTheDocument()
    expect(screen.getByText('Deck officers')).toBeInTheDocument()
    expect(screen.getByText('Free access')).toBeInTheDocument()
    expect(screen.getByText('Certificate enabled')).toBeInTheDocument()
    expect(screen.getByText('No curriculum evidence is available for this course.')).toBeInTheDocument()
    expect(screen.getByTestId('course-review-controls')).toHaveTextContent(`${course.courseId}:submitted`)
  })

  it('renders frozen modules, lesson evidence and quiz correct answers for administrator review', async () => {
    mocks.listCoursesForReview.mockResolvedValueOnce([{
      ...course,
      curriculum: [{
        id: 'section-1',
        title: 'Module 1 · Inspection readiness',
        position: 0,
        lessons: [
          {
            id: 'lesson-1',
            title: 'Evidence preparation',
            lessonType: 'article',
            position: 0,
            summary: 'Prepare evidence before the inspection.',
            articleBody: 'Review records, procedures and interview evidence.',
            assetPath: null,
            externalUrl: null,
            durationSeconds: 300,
            isPreview: false,
            isDownloadable: false,
            quiz: null,
          },
          {
            id: 'lesson-2',
            title: 'SIRE knowledge check',
            lessonType: 'quiz',
            position: 1,
            summary: 'Check core knowledge.',
            articleBody: null,
            assetPath: null,
            externalUrl: null,
            durationSeconds: null,
            isPreview: false,
            isDownloadable: false,
            quiz: {
              id: 'quiz-1',
              passPercentage: 80,
              instructions: 'Choose the best answer.',
              questions: [{
                id: 'question-1',
                prompt: 'What should be prepared before inspection?',
                position: 0,
                options: [
                  { id: 'option-1', label: 'Only certificates', position: 0, isCorrect: false },
                  { id: 'option-2', label: 'Evidence, procedures and crew readiness', position: 1, isCorrect: true },
                ],
              }],
            },
          },
        ],
      }],
    }])

    render(await LearningCoursesAdminPage({ searchParams: Promise.resolve({}) }))

    expect(screen.getByText('Curriculum & assessment')).toBeInTheDocument()
    expect(screen.getByText('1 module · 2 lessons')).toBeInTheDocument()
    expect(screen.getByText('Module 1 · Inspection readiness')).toBeInTheDocument()
    expect(screen.getByText('Evidence preparation')).toBeInTheDocument()
    expect(screen.getByText('Review records, procedures and interview evidence.')).toBeInTheDocument()
    expect(screen.getByText('SIRE knowledge check')).toBeInTheDocument()
    expect(screen.getByText('Pass mark 80%')).toBeInTheDocument()
    expect(screen.getByText('What should be prepared before inspection?')).toBeInTheDocument()
    expect(screen.getByText('Evidence, procedures and crew readiness')).toBeInTheDocument()
    expect(screen.getByText('Correct answer')).toBeInTheDocument()
  })

  it('shows requested changes as review history without mutation controls', async () => {
    mocks.listCoursesForReview.mockResolvedValueOnce([{
      ...course,
      status: 'changes_requested',
      adminReviewNote: 'Add a lesson on operator-specific evidence expectations before resubmitting.',
    }])

    render(await LearningCoursesAdminPage({ searchParams: Promise.resolve({ status: 'changes_requested' }) }))

    expect(mocks.listCoursesForReview).toHaveBeenCalledWith('admin-1', 'changes_requested')
    expect(screen.getByRole('link', { name: 'Changes requested' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Add a lesson on operator-specific evidence expectations before resubmitting.')).toBeInTheDocument()
    expect(screen.queryByTestId('course-review-controls')).not.toBeInTheDocument()
  })

  it.each([
    ['approved', 'Approved'],
    ['published', 'Published'],
  ] as const)('keeps %s courses actionable for the next administrator transition', async (status, label) => {
    mocks.listCoursesForReview.mockResolvedValueOnce([{ ...course, status }])

    render(await LearningCoursesAdminPage({ searchParams: Promise.resolve({ status }) }))

    expect(mocks.listCoursesForReview).toHaveBeenCalledWith('admin-1', status)
    expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByTestId('course-review-controls')).toHaveTextContent(`${course.courseId}:${status}`)
  })

  it('falls back to submitted for a status outside the administrator course queues', async () => {
    render(await LearningCoursesAdminPage({ searchParams: Promise.resolve({ status: 'draft' }) }))

    expect(mocks.listCoursesForReview).toHaveBeenCalledWith('admin-1', 'submitted')
  })

  it('shows a useful empty state when the selected course queue has no courses', async () => {
    mocks.listCoursesForReview.mockResolvedValueOnce([])

    render(await LearningCoursesAdminPage({ searchParams: Promise.resolve({ status: 'archived' }) }))

    expect(screen.getByText('No courses in this review queue.')).toBeInTheDocument()
  })
})

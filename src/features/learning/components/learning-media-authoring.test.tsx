import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseDraftInput } from '../course-repository'
import type { MentorCurriculum } from '../mentor-curriculum-repository'

const mocks = vi.hoisted(() => ({
  createCourseDraft: vi.fn(),
  updateCourseDraft: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }))
vi.mock('../course-actions', () => ({ createCourseDraft: mocks.createCourseDraft, updateCourseDraft: mocks.updateCourseDraft }))
vi.mock('../mentor-curriculum-actions', () => ({
  createCurriculumLesson: vi.fn(),
  createCurriculumSection: vi.fn(),
  deleteCurriculumLesson: vi.fn(),
  deleteCurriculumSection: vi.fn(),
  moveCurriculumLesson: vi.fn(),
  moveCurriculumSection: vi.fn(),
  saveCurriculumQuiz: vi.fn(),
  updateCurriculumLesson: vi.fn(),
  updateCurriculumSection: vi.fn(),
}))

import { CourseForm } from './course-form'
import { MentorCurriculumEditor } from './mentor-curriculum-editor'

const courseId = '33333333-3333-4333-8333-333333333333'
const course: CourseDraftInput = {
  slug: 'bridge-resource-management',
  title: 'Bridge Resource Management',
  subtitle: null,
  description: 'A practical bridge resource management course for maritime officers covering communication, situational awareness and decision making.',
  category: 'Leadership',
  level: 'intermediate',
  language: 'English',
  thumbnailPath: null,
  trailerPath: null,
  learningOutcomes: ['Improve bridge communication'],
  requirements: [],
  targetAudience: ['Deck Officers'],
  accessType: 'free',
  priceMinor: 0,
  discountPriceMinor: null,
  currency: 'INR',
  certificateEnabled: true,
  courseFormat: 'recorded',
}

const curriculum: MentorCurriculum = {
  courseId,
  status: 'draft',
  sections: [{
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Bridge foundations',
    position: 0,
    lessons: [{
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Bridge walkthrough',
      lessonType: 'video',
      position: 0,
      summary: null,
      articleBody: null,
      assetPath: null,
      externalUrl: 'https://example.com/bridge-video',
      durationSeconds: 600,
      isPreview: false,
      isDownloadable: false,
      quiz: null,
    }],
  }],
}

describe('Mentor Studio media authoring UX', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('offers course thumbnail and trailer uploads only after the draft has a course id', () => {
    const { rerender } = render(<CourseForm initialValue={course} />)
    expect(screen.queryByLabelText('Course thumbnail file')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Course trailer file')).not.toBeInTheDocument()

    rerender(<CourseForm initialValue={course} courseId={courseId} />)
    expect(screen.getByLabelText('Course thumbnail file')).toHaveAttribute('accept', 'image/jpeg,image/png,image/webp')
    expect(screen.getByLabelText('Course trailer file')).toHaveAttribute('accept', 'video/mp4,video/webm')
  })

  it('replaces the raw asset-path field with a video upload while preserving the external URL fallback', () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Bridge walkthrough' }))

    expect(screen.queryByLabelText('Edit lesson asset path')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Edit lesson video file')).toHaveAttribute('accept', 'video/mp4,video/webm')
    expect(screen.getByLabelText('Edit lesson external URL')).toHaveValue('https://example.com/bridge-video')
    expect(screen.getByText(/use external url instead/i)).toBeInTheDocument()
  })
})

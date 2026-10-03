import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseDraftInput } from '../course-repository'
import type { MentorMaterialCurriculum } from '../mentor-material-repository'

const mocks = vi.hoisted(() => ({
  createCourseDraft: vi.fn(),
  updateCourseDraft: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: mocks.push }) }))
vi.mock('../course-actions', () => ({ createCourseDraft: mocks.createCourseDraft, updateCourseDraft: mocks.updateCourseDraft }))
vi.mock('../mentor-curriculum-actions', () => ({
  createCurriculumSection: vi.fn(),
  deleteCurriculumLesson: vi.fn(),
  deleteCurriculumSection: vi.fn(),
  moveCurriculumLesson: vi.fn(),
  moveCurriculumSection: vi.fn(),
  saveCurriculumQuiz: vi.fn(),
  updateCurriculumSection: vi.fn(),
}))
vi.mock('../mentor-material-actions', () => ({
  createCurriculumMaterial: vi.fn(),
  updateCurriculumMaterial: vi.fn(),
  updateCourseNavigationMode: vi.fn(),
}))
vi.mock('../scorm-authoring-actions', () => ({ processCurriculumScormPackage: vi.fn() }))

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

const curriculum: MentorMaterialCurriculum = {
  courseId,
  status: 'draft',
  navigationMode: 'free',
  sections: [{
    id: '44444444-4444-4444-8444-444444444444',
    title: 'Bridge foundations',
    position: 0,
    materials: [{
      id: '55555555-5555-4555-8555-555555555555',
      title: 'Bridge walkthrough',
      materialType: 'video',
      position: 0,
      summary: null,
      articleBody: null,
      assetPath: null,
      externalUrl: 'https://example.com/bridge-video',
      durationSeconds: 600,
      isPreview: false,
      isDownloadable: false,
      isPublished: true,
      releaseMode: 'immediate',
      releaseAt: null,
      dripDelayDays: null,
      prerequisiteLessonId: null,
      completionRule: 'media_percentage',
      completionThreshold: 90,
      maxAttempts: null,
      embedKind: null,
      assignment: null,
      quiz: null,
      scorm: null,
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

  it('uses the first-class video uploader while preserving the external URL fallback', () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Bridge walkthrough' }))

    expect(screen.queryByLabelText(/asset path/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/Edit Lesson video file/i)).toHaveAttribute('accept', 'video/mp4,video/webm')
    expect(screen.getByLabelText('Edit material external URL')).toHaveValue('https://example.com/bridge-video')
    expect(screen.getByText(/optional alternative to upload/i)).toBeInTheDocument()
  })
})
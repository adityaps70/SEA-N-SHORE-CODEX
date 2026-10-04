import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseDraftInput } from '../course-repository'

const mocks = vi.hoisted(() => ({
  submitCourseForReview: vi.fn(),
  updateCourseDraft: vi.fn(),
  createCourseDraft: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('../course-actions', () => ({
  submitCourseForReview: mocks.submitCourseForReview,
  updateCourseDraft: mocks.updateCourseDraft,
  createCourseDraft: mocks.createCourseDraft,
}))

import { CourseSubmitControl } from './course-submit-control'
import { CourseEditSession } from './course-edit-session'
import { CourseForm } from './course-form'

const courseId = '33333333-3333-4333-8333-333333333333'

const initial: CourseDraftInput = {
  slug: 'sire-2-readiness',
  title: 'SIRE 2.0 Readiness',
  subtitle: null,
  description: 'A practical maritime course that helps tanker officers prepare for SIRE 2.0 inspections.',
  category: 'SIRE 2.0',
  level: 'advanced',
  language: 'English',
  thumbnailPath: null,
  trailerPath: null,
  learningOutcomes: ['Explain SIRE 2.0 expectations'],
  requirements: [],
  targetAudience: [],
  accessType: 'free',
  priceMinor: 0,
  discountPriceMinor: null,
  currency: 'INR',
  certificateEnabled: true,
  courseFormat: 'recorded',
}

function renderEditor(revision = 3) {
  return render(
    <CourseEditSession initialDetailsRevision={revision}>
      <CourseForm initialValue={initial} courseId={courseId} />
      <CourseSubmitControl courseId={courseId} resubmission />
    </CourseEditSession>,
  )
}

describe('CourseSubmitControl', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.submitCourseForReview.mockResolvedValue({ ok: true })
    mocks.updateCourseDraft.mockImplementation(async (_id: string, course: CourseDraftInput, revision: number | null) => ({
      ok: true,
      revision: (revision ?? 0) + 1,
      savedAt: '2026-09-27T09:02:00.000Z',
      course,
    }))
  })

  afterEach(() => cleanup())

  it('submits the exact course for Sea N Shore review and shows the result on the page', async () => {
    render(<CourseSubmitControl courseId={courseId} />)

    expect(screen.getByText(/unsaved changes on this page are saved first/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    await waitFor(() => expect(mocks.submitCourseForReview).toHaveBeenCalledWith(courseId, null))
    expect(await screen.findByText(/submitted for review with your latest changes/i)).toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalled()
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('shows a safe workflow error without navigating away', async () => {
    mocks.submitCourseForReview.mockResolvedValueOnce({
      ok: false,
      error: 'Section “Module 1” needs at least one published material.',
    })
    render(<CourseSubmitControl courseId={courseId} />)

    fireEvent.click(screen.getByRole('button', { name: 'Submit for review' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Not submitted. Section “Module 1” needs at least one published material.')
    expect(mocks.push).not.toHaveBeenCalled()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('saves unsaved course edits first, then resubmits the revision it just saved', async () => {
    renderEditor(3)

    fireEvent.change(screen.getByLabelText('Course title'), { target: { value: 'SIRE 2.0 Readiness — revised after review' } })
    expect(screen.getByText('Will be saved first: Course details')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Resubmit for review' }))

    await waitFor(() => expect(mocks.submitCourseForReview).toHaveBeenCalledTimes(1))
    expect(mocks.updateCourseDraft).toHaveBeenCalledWith(courseId, expect.objectContaining({
      title: 'SIRE 2.0 Readiness — revised after review',
    }), 3)
    expect(mocks.submitCourseForReview).toHaveBeenCalledWith(courseId, 4)
    expect(mocks.updateCourseDraft.mock.invocationCallOrder[0]).toBeLessThan(mocks.submitCourseForReview.mock.invocationCallOrder[0]!)
    expect(await screen.findByText(/resubmitted for review with your latest changes/i)).toBeInTheDocument()
  })

  it('does not submit when saving the latest edits fails, and keeps the edits', async () => {
    mocks.updateCourseDraft.mockResolvedValueOnce({ ok: false, error: 'Course description needs at least 40 characters so learners understand what the course covers.' })
    renderEditor()

    fireEvent.change(screen.getByLabelText('Course description'), { target: { value: 'Too short' } })
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit for review' }))

    const alerts = await screen.findAllByRole('alert')
    expect(alerts.map((alert) => alert.textContent).join(' ')).toContain('Not submitted. Course details could not be saved: Course description needs at least 40 characters')
    expect(mocks.submitCourseForReview).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Course description')).toHaveValue('Too short')
  })

  it('submits straight away when there is nothing unsaved', async () => {
    renderEditor(5)

    fireEvent.click(screen.getByRole('button', { name: 'Resubmit for review' }))

    await waitFor(() => expect(mocks.submitCourseForReview).toHaveBeenCalledWith(courseId, 5))
    expect(mocks.updateCourseDraft).not.toHaveBeenCalled()
  })

  it('waits for a save that is already running instead of re-saving with a stale revision', async () => {
    let finishFirstSave: () => void = () => undefined
    mocks.updateCourseDraft.mockImplementationOnce((_id: string, course: CourseDraftInput, revision: number | null) => new Promise((resolve) => {
      finishFirstSave = () => resolve({ ok: true, revision: (revision ?? 0) + 1, savedAt: '2026-09-27T09:02:00.000Z', course })
    }))
    renderEditor(3)

    fireEvent.change(screen.getByLabelText('Course title'), { target: { value: 'Saved then submitted quickly' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save course changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Resubmit for review' }))

    await act(async () => {
      finishFirstSave()
    })

    await waitFor(() => expect(mocks.submitCourseForReview).toHaveBeenCalledWith(courseId, 4))
    const revisionsSent = mocks.updateCourseDraft.mock.calls.map((call) => call[2])
    expect(revisionsSent.filter((revision) => revision === 3)).toHaveLength(1)
  })
})

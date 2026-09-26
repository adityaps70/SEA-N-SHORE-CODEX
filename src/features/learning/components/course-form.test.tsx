import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseDraftInput } from '../course-repository'

const mocks = vi.hoisted(() => ({
  createCourseDraft: vi.fn(),
  updateCourseDraft: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: vi.fn() }),
}))

vi.mock('../course-actions', () => ({
  createCourseDraft: mocks.createCourseDraft,
  updateCourseDraft: mocks.updateCourseDraft,
}))

import { CourseForm } from './course-form'
import { CourseEditSession } from './course-edit-session'

const courseId = '33333333-3333-4333-8333-333333333333'
const initial: CourseDraftInput = {
  slug: 'sire-2-readiness-for-tanker-officers',
  title: 'SIRE 2.0 Readiness for Tanker Officers',
  subtitle: 'Practical preparation for inspections and onboard competency',
  description: 'A practical maritime course that helps tanker officers understand SIRE 2.0 expectations, prepare evidence and improve onboard competency before an inspection.',
  category: 'SIRE 2.0',
  level: 'advanced',
  language: 'English',
  thumbnailPath: null,
  trailerPath: null,
  learningOutcomes: ['Understand SIRE 2.0 expectations', 'Prepare practical onboard evidence'],
  requirements: ['Active or recent tanker experience'],
  targetAudience: ['Deck Officers', 'Marine Superintendents'],
  accessType: 'free',
  priceMinor: 0,
  discountPriceMinor: null,
  currency: 'INR',
  certificateEnabled: true,
  courseFormat: 'recorded',
}

describe('CourseForm', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.createCourseDraft.mockResolvedValue({ ok: true, courseId })
    mocks.updateCourseDraft.mockImplementation(async (_courseId: string, course: CourseDraftInput, revision: number | null) => ({
      ok: true,
      revision: (revision ?? 1) + 1,
      savedAt: '2026-09-27T09:02:00.000Z',
      course: { ...course, title: course.title.trim() },
    }))
  })

  afterEach(() => cleanup())

  it('renders the maritime course metadata needed for a mentor draft', () => {
    render(<CourseForm initialValue={initial} />)

    expect(screen.getByLabelText('Course title')).toHaveValue(initial.title)
    expect(screen.getByLabelText('Course URL slug')).toHaveValue(initial.slug)
    expect(screen.getByLabelText('Category')).toHaveValue('SIRE 2.0')
    expect(screen.getByLabelText('Level')).toHaveValue('advanced')
    expect(screen.getByLabelText('Course format')).toHaveValue('recorded')
    expect(screen.getByLabelText('Learning outcomes')).toHaveValue('Understand SIRE 2.0 expectations\nPrepare practical onboard evidence')
    expect(screen.getByLabelText('Target audience')).toHaveValue('Deck Officers\nMarine Superintendents')
    expect(screen.getByRole('button', { name: 'Create draft course' })).toBeInTheDocument()
  })

  it('normalizes list fields, keeps a free course at zero price and opens the new editor after creation', async () => {
    render(<CourseForm initialValue={initial} />)

    fireEvent.change(screen.getByLabelText('Learning outcomes'), {
      target: { value: ' Understand SIRE 2.0 expectations\nunderstand sire 2.0 expectations\n\n Lead an effective inspection briefing, including the CVIQ walk-through ' },
    })
    fireEvent.change(screen.getByLabelText('Requirements'), {
      target: { value: ' Tanker experience\ntanker experience\nOfficer certificate ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft course' }))

    await waitFor(() => expect(mocks.createCourseDraft).toHaveBeenCalledTimes(1))
    expect(mocks.createCourseDraft).toHaveBeenCalledWith(expect.objectContaining({
      learningOutcomes: ['Understand SIRE 2.0 expectations', 'Lead an effective inspection briefing, including the CVIQ walk-through'],
      requirements: ['Tanker experience', 'Officer certificate'],
      accessType: 'free',
      priceMinor: 0,
      discountPriceMinor: null,
      thumbnailPath: null,
      trailerPath: null,
    }))
    expect(mocks.push).toHaveBeenCalledWith(`/learn/studio/courses/${courseId}/edit`)
  })

  it('converts paid course rupee metadata into integer minor units and explains that checkout is not active yet', async () => {
    render(<CourseForm initialValue={{ ...initial, accessType: 'paid', priceMinor: 149900, discountPriceMinor: 99900 }} />)

    expect(screen.getByLabelText('Course price (INR)')).toHaveValue(1499)
    expect(screen.getByLabelText('Discount price (INR)')).toHaveValue(999)
    expect(screen.getByText(/paid enrollment will activate in the commerce phase/i)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Create draft course' }))
    await waitFor(() => expect(mocks.createCourseDraft).toHaveBeenCalledTimes(1))
    expect(mocks.createCourseDraft).toHaveBeenCalledWith(expect.objectContaining({
      accessType: 'paid',
      priceMinor: 149900,
      discountPriceMinor: 99900,
      currency: 'INR',
    }))
  })

  it('updates an existing editable course without navigating away', async () => {
    render(<CourseForm initialValue={initial} courseId={courseId} />)

    fireEvent.change(screen.getByLabelText('Course title'), { target: { value: 'SIRE 2.0 Readiness — Practical Masterclass' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save course changes' }))

    await waitFor(() => expect(mocks.updateCourseDraft).toHaveBeenCalledTimes(1))
    expect(mocks.updateCourseDraft).toHaveBeenCalledWith(courseId, expect.objectContaining({
      title: 'SIRE 2.0 Readiness — Practical Masterclass',
    }), null)
    expect(mocks.push).not.toHaveBeenCalled()
    expect(await screen.findByText(/^Saved at \d{2}:\d{2}$/)).toBeInTheDocument()
  })

  it('shows Unsaved changes, then Saving…, then Saved at HH:MM', async () => {
    let resolveSave: (value: unknown) => void = () => undefined
    mocks.updateCourseDraft.mockImplementationOnce((_id: string, course: CourseDraftInput) => new Promise((resolve) => {
      resolveSave = () => resolve({ ok: true, revision: 6, savedAt: '2026-09-27T09:02:00.000Z', course })
    }))
    render(<CourseForm initialValue={initial} courseId={courseId} />)

    expect(screen.getByText('All changes saved')).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Course description'), { target: { value: `${initial.description} Includes a practical vetting checklist.` } })
    expect(screen.getByText('Unsaved changes')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save course changes' }))
    expect(await screen.findByRole('button', { name: 'Saving…' })).toBeDisabled()
    expect(screen.getAllByText('Saving…').length).toBeGreaterThan(0)

    await act(async () => {
      resolveSave(undefined)
    })
    const expectedTime = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date('2026-09-27T09:02:00.000Z'))
    expect(await screen.findByText(`Saved at ${expectedTime}`)).toBeInTheDocument()
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument()
  })

  it('sends the revision it last saved with each save so stale saves are refused, not applied', async () => {
    render(
      <CourseEditSession initialDetailsRevision={4}>
        <CourseForm initialValue={initial} courseId={courseId} />
      </CourseEditSession>,
    )

    fireEvent.change(screen.getByLabelText('Course title'), { target: { value: 'First edit title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save course changes' }))
    await waitFor(() => expect(mocks.updateCourseDraft).toHaveBeenLastCalledWith(courseId, expect.objectContaining({ title: 'First edit title' }), 4))
    await screen.findByText(/^Saved at/)

    fireEvent.change(screen.getByLabelText('Course title'), { target: { value: 'Second edit title' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save course changes' }))
    await waitFor(() => expect(mocks.updateCourseDraft).toHaveBeenLastCalledWith(courseId, expect.objectContaining({ title: 'Second edit title' }), 5))
  })

  it('keeps the edits and says they were not saved when the server refuses the save', async () => {
    mocks.updateCourseDraft.mockResolvedValueOnce({
      ok: false,
      error: 'Your changes were not saved because this course is in review. Withdraw it from review on the edit page to make changes, then resubmit.',
    })
    render(<CourseForm initialValue={initial} courseId={courseId} />)

    fireEvent.change(screen.getByLabelText('Course title'), { target: { value: 'Edit made in another tab' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save course changes' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('not saved because this course is in review')
    expect(screen.getByText('Not saved — your changes are still here')).toBeInTheDocument()
    expect(screen.getByLabelText('Course title')).toHaveValue('Edit made in another tab')
  })

  it('shows the stored, normalized values after saving', async () => {
    render(<CourseForm initialValue={initial} courseId={courseId} />)

    fireEvent.change(screen.getByLabelText('Course title'), { target: { value: '  Padded title  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save course changes' }))

    await waitFor(() => expect(screen.getByLabelText('Course title')).toHaveValue('Padded title'))
    expect(screen.getByText(/^Saved at/)).toBeInTheDocument()
  })

  it('renders a read-only course without a save button', () => {
    render(<CourseForm initialValue={initial} courseId={courseId} readOnly />)

    expect(screen.getByLabelText('Course title')).toBeDisabled()
    expect(screen.getByLabelText('Course description')).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Save course changes' })).not.toBeInTheDocument()
  })

  it('surfaces a safe action error without clearing mentor input', async () => {
    mocks.createCourseDraft.mockResolvedValueOnce({ ok: false, error: 'A course with this URL slug already exists.' })
    render(<CourseForm initialValue={initial} />)

    fireEvent.change(screen.getByLabelText('Course title'), { target: { value: 'My revised tanker course' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft course' }))

    expect(await screen.findByText('A course with this URL slug already exists.')).toBeInTheDocument()
    expect(screen.getByLabelText('Course title')).toHaveValue('My revised tanker course')
  })
})

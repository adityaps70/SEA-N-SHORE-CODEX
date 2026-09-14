import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseDraftInput } from '../course-repository'

const mocks = vi.hoisted(() => ({
  createCourseDraft: vi.fn(),
  updateCourseDraft: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push }),
}))

vi.mock('../course-actions', () => ({
  createCourseDraft: mocks.createCourseDraft,
  updateCourseDraft: mocks.updateCourseDraft,
}))

import { CourseForm } from './course-form'

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
    mocks.updateCourseDraft.mockResolvedValue({ ok: true })
  })

  afterEach(() => cleanup())

  it('renders the maritime course metadata needed for a mentor draft', () => {
    render(<CourseForm initialValue={initial} />)

    expect(screen.getByLabelText('Course title')).toHaveValue(initial.title)
    expect(screen.getByLabelText('Course URL slug')).toHaveValue(initial.slug)
    expect(screen.getByLabelText('Category')).toHaveValue('SIRE 2.0')
    expect(screen.getByLabelText('Level')).toHaveValue('advanced')
    expect(screen.getByLabelText('Course format')).toHaveValue('recorded')
    expect(screen.getByLabelText('Learning outcomes')).toHaveValue('Understand SIRE 2.0 expectations, Prepare practical onboard evidence')
    expect(screen.getByLabelText('Target audience')).toHaveValue('Deck Officers, Marine Superintendents')
    expect(screen.getByRole('button', { name: 'Create draft course' })).toBeInTheDocument()
  })

  it('normalizes list fields, keeps a free course at zero price and opens the new editor after creation', async () => {
    render(<CourseForm initialValue={initial} />)

    fireEvent.change(screen.getByLabelText('Learning outcomes'), {
      target: { value: ' Understand SIRE 2.0 expectations, understand sire 2.0 expectations, Lead an effective inspection briefing ' },
    })
    fireEvent.change(screen.getByLabelText('Requirements'), {
      target: { value: ' Tanker experience, tanker experience, Officer certificate ' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Create draft course' }))

    await waitFor(() => expect(mocks.createCourseDraft).toHaveBeenCalledTimes(1))
    expect(mocks.createCourseDraft).toHaveBeenCalledWith(expect.objectContaining({
      learningOutcomes: ['Understand SIRE 2.0 expectations', 'Lead an effective inspection briefing'],
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
    }))
    expect(mocks.push).not.toHaveBeenCalled()
    expect(await screen.findByText('Course changes saved.')).toBeInTheDocument()
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

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  enrolLearnerByEmail: vi.fn(),
  cancelCourseInvitation: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../course-roster-actions', () => ({
  enrolLearnerByEmail: mocks.enrolLearnerByEmail,
  cancelCourseInvitation: mocks.cancelCourseInvitation,
}))

import type { RosterEnrolOutcome } from '../course-roster'
import { CancelInvitationButton, CourseRosterEnrolForm } from './course-roster-enrol-form'

const courseId = '22222222-2222-4222-8222-222222222222'
const invitationId = '77777777-7777-4777-8777-777777777777'

function addLearner(email: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: email } })
  fireEvent.click(screen.getByRole('button', { name: /Add learner/ }))
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CourseRosterEnrolForm', () => {
  it('keeps "Add learner" disabled until an email is typed', () => {
    render(<CourseRosterEnrolForm courseId={courseId} disabledReason={null} />)
    expect(screen.getByRole('button', { name: /Add learner/ })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: '   ' } })
    expect(screen.getByRole('button', { name: /Add learner/ })).toBeDisabled()
    fireEvent.change(screen.getByRole('textbox', { name: 'Email address' }), { target: { value: 'fixture@example.test' } })
    expect(screen.getByRole('button', { name: /Add learner/ })).toBeEnabled()
  })

  it.each<[RosterEnrolOutcome, string]>([
    [{ kind: 'enrolled', name: 'Fixture Learner' }, 'Fixture Learner is enrolled and has been notified.'],
    [{ kind: 'already_enrolled', name: 'Fixture Learner' }, 'Fixture Learner is already enrolled.'],
    [{ kind: 'invited' }, 'Invitation sent. They will be enrolled when they sign up with this email address.'],
    [{ kind: 'already_invited' }, 'This email address already has an invitation waiting.'],
  ])('confirms the %o outcome, clears the field and refreshes the roster', async (outcome, text) => {
    mocks.enrolLearnerByEmail.mockResolvedValue({ ok: true, outcome })
    render(<CourseRosterEnrolForm courseId={courseId} disabledReason={null} />)

    addLearner('fixture@example.test')

    expect(await screen.findByRole('status')).toHaveTextContent(text)
    expect(mocks.enrolLearnerByEmail).toHaveBeenCalledWith(courseId, 'fixture@example.test')
    expect(screen.getByRole('textbox', { name: 'Email address' })).toHaveValue('')
    expect(mocks.refresh).toHaveBeenCalledTimes(1)
  })

  it('shows the action’s error, keeps the email and marks the field invalid', async () => {
    mocks.enrolLearnerByEmail.mockResolvedValue({ ok: false, error: 'Enter one email address, for example name@example.com' })
    render(<CourseRosterEnrolForm courseId={courseId} disabledReason={null} />)

    addLearner('not-an-email')

    expect(await screen.findByRole('alert')).toHaveTextContent('Enter one email address, for example name@example.com')
    const input = screen.getByRole('textbox', { name: 'Email address' })
    expect(input).toHaveValue('not-an-email')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAttribute('aria-describedby', 'roster-enrol-message')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('shows the reason instead of the field when learners cannot be added', () => {
    render(<CourseRosterEnrolForm courseId={courseId} disabledReason="Fixture reason: the course is closed." />)
    expect(screen.getByText('Fixture reason: the course is closed.')).toBeInTheDocument()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Add learner/ })).not.toBeInTheDocument()
  })
})

describe('CancelInvitationButton', () => {
  it('cancels the invitation and refreshes the page', async () => {
    mocks.cancelCourseInvitation.mockResolvedValue({ ok: true })
    render(<CancelInvitationButton courseId={courseId} invitationId={invitationId} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
    expect(mocks.cancelCourseInvitation).toHaveBeenCalledWith(courseId, invitationId)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('shows the action’s error and does not refresh', async () => {
    mocks.cancelCourseInvitation.mockResolvedValue({ ok: false, error: 'This invitation was already used or cancelled.' })
    render(<CancelInvitationButton courseId={courseId} invitationId={invitationId} />)

    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('This invitation was already used or cancelled.')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})

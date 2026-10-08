import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLearningAssignmentState: vi.fn(),
  submitLearningAssignment: vi.fn(),
  createAssignmentAttachmentUpload: vi.fn(),
}))

vi.mock('../learner-assignment-actions', () => ({
  getLearningAssignmentState: mocks.getLearningAssignmentState,
  submitLearningAssignment: mocks.submitLearningAssignment,
  createAssignmentAttachmentUpload: mocks.createAssignmentAttachmentUpload,
}))

import { AssignmentActivity } from './assignment-activity'

const lessonId = '22222222-2222-4222-8222-222222222222'

function state(overrides: Record<string, unknown> = {}) {
  return {
    completed: false,
    maxPoints: 50,
    passingPercentage: 60,
    maxAttempts: 3,
    attemptsUsed: 1,
    attemptsRemaining: 2,
    reviewPending: false,
    latestAttempt: {
      id: 'attempt-1', attemptNumber: 1, status: 'graded', submittedAt: '2026-10-01T00:00:00.000Z', responseText: null,
      scorePoints: 20, percentage: 40, passed: false, feedback: 'Add the photos.', gradedAt: '2026-10-02T00:00:00.000Z',
      attachments: [{ id: '66666666-6666-4666-8666-666666666666', fileName: 'first-try.pdf', contentType: 'application/pdf', sizeBytes: 2048 }],
    },
    attempts: [],
    attachmentRules: { acceptedExtensions: ['.pdf', '.jpg'], maxUploadBytes: 20 * 1024 * 1024, maxFiles: 5 },
    ...overrides,
  }
}

function renderActivity() {
  return render(
    <AssignmentActivity
      slug="sire-readiness"
      lessonId={lessonId}
      instructions="Upload your inspection report."
      acceptedExtensions={['.pdf', '.jpg']}
      maxUploadBytes={20 * 1024 * 1024}
      maxAttempts={3}
      attemptsUsed={1}
      initiallyCompleted={false}
    />,
  )
}

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLearningAssignmentState.mockResolvedValue({ ok: true, state: state() })
})

describe('AssignmentActivity', () => {
  it('shows the grade, pass mark and file rules, with no developer wording', async () => {
    renderActivity()

    expect(await screen.findByText('Grade: 20/50 points · 40% · pass mark 60%')).toBeInTheDocument()
    expect(screen.getByText(/Graded out of 50 points · pass mark 60%/)).toBeInTheDocument()
    expect(screen.getByText(/Files: PDF, JPG · up to 20 MB each · up to 5 files/)).toBeInTheDocument()
    expect(screen.queryByText(/later media slice/)).not.toBeInTheDocument()
  })

  it('refuses a file of the wrong type in the browser, before asking for an upload', async () => {
    renderActivity()
    await screen.findByText(/Graded out of 50 points/)

    const input = document.getElementById(`assignment-files-${lessonId}`) as HTMLInputElement
    fireEvent.change(input, { target: { files: [new File(['<html>'], 'page.html', { type: 'text/html' })] } })

    expect(await screen.findByText(/“page\.html” is not a supported file type/)).toBeInTheDocument()
    expect(mocks.createAssignmentAttachmentUpload).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: /Submit revision/ })).toBeDisabled()
  })

  it('links earlier submitted files through the access-checked download route', async () => {
    mocks.getLearningAssignmentState.mockResolvedValue({ ok: true, state: state({ reviewPending: true, latestAttempt: { ...state().latestAttempt, status: 'submitted', passed: null } }) })
    renderActivity()

    await waitFor(() => expect(screen.getByRole('link', { name: /first-try\.pdf/ })).toHaveAttribute('href', '/api/learn/assignment-attachments/66666666-6666-4666-8666-666666666666'))
  })
})

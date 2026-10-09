import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ save: vi.fn() }))
vi.mock('../certificate-settings-actions', () => ({ saveCourseCertificateSettings: mocks.save }))
vi.mock('./learning-media-upload-field', () => ({ LearningMediaUploadField: ({ label }: { label: string }) => <div>{label}</div> }))

import { CertificateSettingsPanel } from './certificate-settings-panel'
import { DEFAULT_CERTIFICATE_SETTINGS } from '../certificate-settings'

const courseId = '33333333-3333-4333-8333-333333333333'
const quizId = '44444444-4444-4444-8444-444444444444'

afterEach(() => cleanup())
beforeEach(() => vi.clearAllMocks())

describe('CertificateSettingsPanel', () => {
  it('saves the layout, serial prefix, validity and the final quiz', async () => {
    mocks.save.mockImplementation(async (_course, settings) => ({ ok: true, settings }))
    render(<CertificateSettingsPanel courseId={courseId} initial={DEFAULT_CERTIFICATE_SETTINGS} certificateEnabled quizzes={[{ id: quizId, title: 'Final assessment' }]} />)

    fireEvent.click(screen.getByLabelText(/^Formal/))
    fireEvent.change(screen.getByLabelText('Certificate serial prefix'), { target: { value: 'sns sire' } })
    expect(screen.getByText(/Serials look like SNS-SIRE-\d{4}-1A2B3C4D\./)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Certificate validity in months'), { target: { value: '24' } })
    expect(screen.getByText('Learners are reminded 30 and 7 days before it expires.')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText(/Passes the final quiz/))
    fireEvent.change(screen.getByLabelText('Final quiz'), { target: { value: quizId } })
    fireEvent.click(screen.getByRole('button', { name: 'Save certificate settings' }))

    await waitFor(() => expect(mocks.save).toHaveBeenCalledWith(courseId, expect.objectContaining({
      template: 'formal', serialPrefix: 'sns sire', validityMonths: 24, issueTrigger: 'final_quiz', finalLessonId: quizId,
    })))
    expect(await screen.findByText(/Certificate settings saved/)).toBeInTheDocument()
  })

  it('cannot issue on a final quiz when the course has no quiz, and is read-only when the course is locked', () => {
    render(<CertificateSettingsPanel courseId={courseId} initial={DEFAULT_CERTIFICATE_SETTINGS} certificateEnabled={false} quizzes={[]} readOnly />)
    expect(screen.getByLabelText(/Passes the final quiz/)).toBeDisabled()
    expect(screen.getByText(/Certificates are turned off/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save certificate settings' })).not.toBeInTheDocument()
  })
})

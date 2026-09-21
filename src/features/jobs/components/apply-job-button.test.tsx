import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  applyToJob: vi.fn(),
  prepareJobApplicationCvUpload: vi.fn(),
}))

vi.mock('../actions', () => ({
  applyToJob: mocks.applyToJob,
  prepareJobApplicationCvUpload: mocks.prepareJobApplicationCvUpload,
}))

import { ApplyJobButton } from './apply-job-button'

const jobId = '11111111-1111-4111-8111-111111111111'

describe('ApplyJobButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.prepareJobApplicationCvUpload.mockResolvedValue({
      ok: true,
      uploadUrl: 'https://uploads.example.test/cv',
      storagePath: 'job-applications/viewer-1/11111111-1111-4111-8111-111111111111/cv.pdf',
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5,
    })
    mocks.applyToJob.mockResolvedValue({ ok: true, alreadyApplied: false })
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 200 })))
  })

  it('opens a focused application form and uploads an optional PDF CV before applying', async () => {
    render(<ApplyJobButton jobId={jobId} alreadyApplied={false} compact />)

    fireEvent.click(screen.getByRole('button', { name: 'Easy Apply' }))

    expect(screen.getByRole('dialog', { name: 'Apply for this job' })).toBeVisible()
    const file = new File(['%PDF-'], 'resume.pdf', { type: 'application/pdf' })
    fireEvent.change(screen.getByLabelText('Attach CV (PDF)'), { target: { files: [file] } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit application' }))

    await waitFor(() => expect(mocks.prepareJobApplicationCvUpload).toHaveBeenCalledWith(jobId, {
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: file.size,
    }))
    expect(fetch).toHaveBeenCalledWith('https://uploads.example.test/cv', expect.objectContaining({
      method: 'PUT',
      body: file,
      headers: { 'Content-Type': 'application/pdf' },
    }))
    expect(mocks.applyToJob).toHaveBeenCalledWith(jobId, {
      storagePath: 'job-applications/viewer-1/11111111-1111-4111-8111-111111111111/cv.pdf',
      fileName: 'resume.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 5,
    })
    expect(await screen.findByText('Applied')).toBeVisible()
  })

  it('rejects a non-PDF CV before requesting an upload', async () => {
    render(<ApplyJobButton jobId={jobId} alreadyApplied={false} compact />)

    fireEvent.click(screen.getByRole('button', { name: 'Easy Apply' }))
    const file = new File(['hello'], 'resume.docx', {
      type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })
    fireEvent.change(screen.getByLabelText('Attach CV (PDF)'), { target: { files: [file] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('PDF')
    expect(mocks.prepareJobApplicationCvUpload).not.toHaveBeenCalled()
    expect(mocks.applyToJob).not.toHaveBeenCalled()
  })
})

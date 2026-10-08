import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    }, null)
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

describe('ApplyJobButton minimum match gate (round 12)', () => {
  beforeEach(() => {
    cleanup()
    vi.clearAllMocks()
  })

  it('shows the minimum and the member’s score instead of applying when below the minimum', () => {
    render(<ApplyJobButton jobId={jobId} alreadyApplied={false} variant="bar" gate={{ status: 'below_minimum', message: 'Below this job’s minimum (70%) · you’re at 52%', minimum: 70, score: 52, missing: ['Master / Captain'] }} />)
    const button = screen.getByRole('button', { name: 'Below this job’s minimum (70%) · you’re at 52%' })
    expect(button).toBeDisabled()
    fireEvent.click(button)
    expect(mocks.applyToJob).not.toHaveBeenCalled()
  })

  it('lists the missing profile items as links to their editors on the job page', () => {
    render(<ApplyJobButton jobId={jobId} alreadyApplied={false} gate={{
      status: 'incomplete',
      message: 'Complete your profile to apply',
      gaps: [
        { key: 'rank', label: 'Your current or most recent rank', href: `/profile?edit=profile-header&job=${jobId}` },
        { key: 'certificates', label: 'Your certificates', href: `/profile?edit=credential%3Anew&job=${jobId}` },
      ],
    }} />)
    expect(screen.getByText('Complete your profile to apply')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Your current or most recent rank' })).toHaveAttribute('href', `/profile?edit=profile-header&job=${jobId}`)
    expect(screen.getByRole('link', { name: 'Your certificates' })).toHaveAttribute('href', `/profile?edit=credential%3Anew&job=${jobId}`)
    expect(screen.queryByRole('button', { name: /Apply/ })).not.toBeInTheDocument()
  })

  it('tells a non-seafarer that a sea role is for seafarers, with a link to the profile editor', () => {
    render(<ApplyJobButton jobId={jobId} alreadyApplied={false} gate={{ status: 'sea_job_profile_type', message: 'This role is for seafarers. Update your profile type if this is wrong.', href: `/profile?edit=profile-header&job=${jobId}` }} />)
    expect(screen.getByText('This role is for seafarers. Update your profile type if this is wrong.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Update your profile type/ })).toHaveAttribute('href', `/profile?edit=profile-header&job=${jobId}`)
  })

  it('applies as usual when the gate is open, and switches to the server’s refusal when it says no', async () => {
    mocks.applyToJob.mockResolvedValue({
      ok: false,
      error: 'Below this job’s minimum (70%) · you’re at 60%.',
      gate: { status: 'below_minimum', message: 'Below this job’s minimum (70%) · you’re at 60%', minimum: 70, score: 60, missing: [] },
    })
    render(<ApplyJobButton jobId={jobId} alreadyApplied={false} gate={{ status: 'open' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Apply now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Submit application' }))
    await waitFor(() => expect(mocks.applyToJob).toHaveBeenCalled())
    expect(await screen.findByText('Below this job’s minimum (70%) · you’re at 60%')).toBeInTheDocument()
  })
})

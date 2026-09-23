import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ reportContent: vi.fn() }))
vi.mock('../actions', () => ({ reportContent: mocks.reportContent }))

import { ReportContentButton } from './report-content-button'

describe('ReportContentButton', () => {
  afterEach(() => cleanup())

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.reportContent.mockResolvedValue({ ok: true })
  })

  it('shows target-specific job reasons and submits the report', async () => {
    render(
      <ReportContentButton
        targetType="job"
        targetId="11111111-1111-4111-8111-111111111111"
        label="Report job"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Report job' }))
    expect(screen.getByRole('option', { name: 'Recruitment fee requested' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Copyright or intellectual property infringement' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Harassment or bullying' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'fake_company' } })
    fireEvent.change(screen.getByLabelText('Additional details'), { target: { value: 'Company details do not match.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))

    await waitFor(() => expect(mocks.reportContent).toHaveBeenCalledWith({
      targetType: 'job',
      targetId: '11111111-1111-4111-8111-111111111111',
      reason: 'fake_company',
      details: 'Company details do not match.',
    }))
    expect(await screen.findByText('Report submitted for review.')).toBeVisible()
  })

  it('shows profile-specific reasons and submits a profile report', async () => {
    render(
      <ReportContentButton
        targetType="profile"
        targetId="11111111-1111-4111-8111-111111111111"
        label="Report profile"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Report profile' }))
    expect(screen.getByRole('option', { name: 'Impersonation' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Harassment or bullying' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Spam or scam' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Inappropriate content' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Fake profile' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Other' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'Recruitment fee requested' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'impersonation' } })
    fireEvent.change(screen.getByLabelText('Additional details'), { target: { value: 'This profile is using another seafarer’s identity and photo.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Submit report' }))

    await waitFor(() => expect(mocks.reportContent).toHaveBeenCalledWith({
      targetType: 'profile',
      targetId: '11111111-1111-4111-8111-111111111111',
      reason: 'impersonation',
      details: 'This profile is using another seafarer’s identity and photo.',
    }))
  })

  it('shows copyright-specific guidance when the complaint reason is selected', () => {
    render(
      <ReportContentButton
        targetType="post"
        targetId="11111111-1111-4111-8111-111111111111"
        label="Report post"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Report post' }))
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'copyright_infringement' } })

    expect(screen.getByText(/identify the copyrighted work/i)).toBeVisible()
    expect(screen.getByText(/rights holder or authorised to act/i)).toBeVisible()
  })
})

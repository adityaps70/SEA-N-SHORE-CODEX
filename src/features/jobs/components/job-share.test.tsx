import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/features/moderation/components/report-content-button', () => ({
  ReportContentButton: ({ targetId, defaultOpen }: { targetId: string; defaultOpen?: boolean }) => (
    defaultOpen ? <div role="dialog" aria-label="Report this job">report {targetId}</div> : null
  ),
}))

import { JobDetailMoreMenu } from './job-detail-more-menu'
import { JobShareActions } from './job-share-actions'

const jobId = '11111111-1111-4111-8111-111111111111'
const writeText = vi.fn()

function setShare(share: ((data: ShareData) => Promise<void>) | undefined) {
  Object.defineProperty(navigator, 'share', { value: share, configurable: true, writable: true })
}

afterEach(() => cleanup())

describe('job sharing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writeText.mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    setShare(undefined)
  })

  it('offers Share and Copy link on desktop; Copy link copies the job URL', async () => {
    render(<JobShareActions jobId={jobId} jobTitle="Chief Officer" companyName="Oceanic" />)

    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`http://localhost:3000/jobs/${jobId}`))
    expect(await screen.findByText('Link copied.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Share' })).toBeInTheDocument()
  })

  it('uses the system share sheet when the browser has one', async () => {
    const share = vi.fn().mockResolvedValue(undefined)
    setShare(share)
    render(<JobShareActions jobId={jobId} jobTitle="Chief Officer" companyName="Oceanic" />)

    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(share).toHaveBeenCalledWith({ title: 'Chief Officer', text: 'Chief Officer at Oceanic on Sea N Shore', url: `http://localhost:3000/jobs/${jobId}` }))
    expect(writeText).not.toHaveBeenCalled()
  })

  it('falls back to copying the link when there is no share sheet', async () => {
    render(<JobShareActions jobId={jobId} jobTitle="Chief Officer" companyName="Oceanic" />)
    fireEvent.click(screen.getByRole('button', { name: 'Share' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`http://localhost:3000/jobs/${jobId}`))
  })

  it('puts View organization, Share, Copy link and Report job in the phone "…" sheet', async () => {
    render(<JobDetailMoreMenu jobId={jobId} jobTitle="Chief Officer" companyName="Oceanic" companyHref="/organizations/oceanic" />)

    fireEvent.click(screen.getByRole('button', { name: 'More job actions' }))
    const menu = screen.getByRole('menu', { name: 'Job actions' })
    expect(within(menu).getByRole('menuitem', { name: 'View organization' })).toHaveAttribute('href', '/organizations/oceanic')
    expect(within(menu).getByRole('menuitem', { name: 'Share' })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy link' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`http://localhost:3000/jobs/${jobId}`))

    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Report job' }))
    expect(screen.getByRole('dialog', { name: 'Report this job' })).toHaveTextContent(jobId)
    expect(screen.queryByRole('menu', { name: 'Job actions' })).toBeNull()
  })

  it('leaves out View organization for personal recruiter jobs', () => {
    render(<JobDetailMoreMenu jobId={jobId} jobTitle="Chief Officer" companyName="Capt Rao" companyHref={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'More job actions' }))
    expect(screen.queryByRole('menuitem', { name: 'View organization' })).toBeNull()
  })
})

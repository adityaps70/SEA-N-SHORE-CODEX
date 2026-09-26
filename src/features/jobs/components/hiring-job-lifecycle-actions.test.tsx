import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { JobLifecycleSnapshot } from '../job-lifecycle'

const mocks = vi.hoisted(() => ({
  changeHiringJobStatus: vi.fn(),
  deleteHiringJob: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('../hiring-actions', () => ({
  changeHiringJobStatus: mocks.changeHiringJobStatus,
  deleteHiringJob: mocks.deleteHiringJob,
}))
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }),
}))

import { HiringJobLifecycleActions } from './hiring-job-lifecycle-actions'

const jobId = '22222222-2222-4222-8222-222222222222'
const today = '2026-09-27'

function lifecycle(overrides: Partial<JobLifecycleSnapshot> = {}): JobLifecycleSnapshot {
  return {
    status: 'draft',
    deleted: false,
    moderationRemoved: false,
    applyUntil: null,
    joiningUntil: null,
    applicantCount: 0,
    canDelete: true,
    ...overrides,
  }
}

function renderActions(overrides: Partial<JobLifecycleSnapshot> = {}) {
  return render(<HiringJobLifecycleActions jobId={jobId} jobTitle="Chief Officer" lifecycle={lifecycle(overrides)} today={today} />)
}

afterEach(() => cleanup())

describe('HiringJobLifecycleActions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.changeHiringJobStatus.mockResolvedValue({ ok: true })
    mocks.deleteHiringJob.mockResolvedValue({ ok: true })
  })

  it('shows only the actions the lifecycle allows', () => {
    renderActions({ status: 'published' })
    expect(screen.getByRole('button', { name: 'Archive' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Publish' })).toBeNull()
    cleanup()

    renderActions({ status: 'closed', canDelete: false })
    expect(screen.getByRole('button', { name: 'Republish' })).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Delete' })).toBeNull()
    cleanup()

    renderActions({ status: 'closed', moderationRemoved: true })
    expect(screen.queryByRole('button', { name: 'Republish' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Delete' })).toBeVisible()
  })

  it('deletes a draft only after an in-page confirmation', async () => {
    renderActions({ status: 'draft' })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    expect(screen.getByRole('heading', { name: 'Delete “Chief Officer”?' })).toHaveFocus()
    expect(mocks.deleteHiringJob).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Delete job' }))
    await waitFor(() => expect(mocks.deleteHiringJob).toHaveBeenCalledWith(jobId))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/hiring/jobs?notice=deleted'))
  })

  it('explains what happens to applicants before deleting an archived job', () => {
    renderActions({ status: 'closed', applicantCount: 3 })
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    expect(screen.getByText(/3 people have applied\. Their applications stay in their own history/)).toBeVisible()
  })

  it('closes the confirmation with Escape or Cancel without changing anything', () => {
    renderActions({ status: 'published' })
    const archive = screen.getByRole('button', { name: 'Archive' })
    fireEvent.click(archive)
    fireEvent.keyDown(screen.getByRole('heading', { name: 'Archive “Chief Officer”?' }), { key: 'Escape' })
    expect(screen.queryByRole('heading', { name: 'Archive “Chief Officer”?' })).toBeNull()
    expect(archive).toHaveFocus()

    fireEvent.click(archive)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('region')).toBeNull()
    expect(mocks.changeHiringJobStatus).not.toHaveBeenCalled()
  })

  it('asks for a new apply-by date before republishing a job whose date has passed', async () => {
    renderActions({ status: 'closed', applyUntil: '2026-09-01' })
    fireEvent.click(screen.getByRole('button', { name: 'Republish' }))
    expect(screen.getByText(/previous apply-by date \(.*2026\) has passed/)).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Republish job' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an apply-by date')
    expect(mocks.changeHiringJobStatus).not.toHaveBeenCalled()

    fireEvent.change(screen.getByLabelText('Apply by'), { target: { value: '2026-10-31' } })
    fireEvent.click(screen.getByRole('button', { name: 'Republish job' }))
    await waitFor(() => expect(mocks.changeHiringJobStatus).toHaveBeenCalledWith(jobId, 'republish', { applyUntil: '2026-10-31' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Job republished')
  })

  it('republishes with no closing date when chosen', async () => {
    renderActions({ status: 'closed', applyUntil: '2026-09-01' })
    fireEvent.click(screen.getByRole('button', { name: 'Republish' }))
    fireEvent.click(screen.getByLabelText('No closing date'))
    fireEvent.click(screen.getByRole('button', { name: 'Republish job' }))
    await waitFor(() => expect(mocks.changeHiringJobStatus).toHaveBeenCalledWith(jobId, 'republish', { applyUntil: null }))
  })

  it('shows the server’s explanation when a change is refused', async () => {
    mocks.changeHiringJobStatus.mockResolvedValue({ ok: false, error: 'This job was changed in another window.' })
    renderActions({ status: 'published' })
    fireEvent.click(screen.getByRole('button', { name: 'Archive' }))
    fireEvent.click(screen.getByRole('button', { name: 'Archive job' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This job was changed in another window.')
  })
})

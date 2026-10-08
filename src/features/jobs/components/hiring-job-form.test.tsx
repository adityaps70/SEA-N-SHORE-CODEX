import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createHiringJob: vi.fn(),
  updateHiringJob: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('../hiring-actions', () => ({ createHiringJob: mocks.createHiringJob, updateHiringJob: mocks.updateHiringJob }))

import { HiringJobForm } from './hiring-job-form'
import type { HiringEditableJob } from '../hiring-repository'

const publisher = { key: 'personal', kind: 'personal' as const, id: 'user-1', name: 'Asha Recruiter', canPublish: true, blocker: null, role: null, verified: true }

function fillBasics() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Job title' }), { target: { value: 'Master' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: 'Command a tanker.' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Full command.' } })
}

beforeEach(() => {
  mocks.createHiringJob.mockResolvedValue({ ok: true, jobId: 'job-1' })
  mocks.updateHiringJob.mockResolvedValue({ ok: true })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('HiringJobForm department, accepted ranks and minimum match (round 12)', () => {
  it('picks a department, then several accepted ranks from it, and sets the job type from the department', async () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    expect(screen.queryByRole('textbox', { name: /Rank/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('checkbox', { name: 'Master / Captain' })).not.toBeInTheDocument()

    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'deck_officers' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Master / Captain' }))
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chief Officer' }))
    expect(screen.getByRole('combobox', { name: 'Job type' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'Job type' })).toHaveValue('sea')
    expect(screen.getByRole('spinbutton', { name: /Minimum match to apply/ })).toHaveValue(70)
    expect(screen.getByText(/0 turns it off/)).toBeInTheDocument()

    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Publish job' }))

    await waitFor(() => expect(mocks.createHiringJob).toHaveBeenCalledTimes(1))
    expect(mocks.createHiringJob.mock.calls[0]![0]).toMatchObject({
      domain: 'sea',
      departmentKey: 'deck_officers',
      acceptedRoleKeys: ['master', 'chief_officer'],
      minMatchToApply: 70,
      status: 'published',
    })
  })

  it('switches the job type to shore for a shore department and accepts a minimum of 0', async () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'technical_fleet' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Technical Superintendent' }))
    expect(screen.getByRole('combobox', { name: 'Job type' })).toHaveValue('shore')
    fireEvent.change(screen.getByRole('spinbutton', { name: /Minimum match to apply/ }), { target: { value: '0' } })
    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))

    await waitFor(() => expect(mocks.createHiringJob).toHaveBeenCalledTimes(1))
    expect(mocks.createHiringJob.mock.calls[0]![0]).toMatchObject({ domain: 'shore', minMatchToApply: 0, acceptedRoleKeys: ['technical_superintendent'] })
  })

  it('shows a text box for "Other (type your own)"', () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'catering' } })
    expect(screen.queryByRole('textbox', { name: 'Type the rank / role' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Other (type your own)' }))
    expect(screen.getByRole('textbox', { name: 'Type the rank / role' })).toBeRequired()
  })

  it('pre-selects the rank an older job’s text is recognised as, and keeps its saved minimum', () => {
    const initial = {
      id: 'job-1', companyId: null, status: 'published', title: 'Captain wanted', domain: 'sea', department: 'Deck', rank: 'Captain',
      vesselTypes: [], location: null, regions: [], summary: 's', description: 'd', requirements: null, experienceMinYears: null,
      experienceMaxYears: null, joiningFrom: null, joiningUntil: null, salaryMin: null, salaryMax: null, salaryCurrency: null,
      salaryPeriod: null, urgent: false, easyApply: true, applyUntil: null, certificates: [], visas: [],
      departmentKey: null, acceptedRoleKeys: [], roleOtherText: null, minMatchToApply: 0,
    } satisfies HiringEditableJob
    render(<HiringJobForm mode="edit" jobId="job-1" initial={initial} />)
    expect(screen.getByRole('combobox', { name: 'Department' })).toHaveValue('deck_officers')
    expect(screen.getByRole('checkbox', { name: 'Master / Captain' })).toBeChecked()
    expect(screen.getByRole('spinbutton', { name: /Minimum match to apply/ })).toHaveValue(0)
  })
})

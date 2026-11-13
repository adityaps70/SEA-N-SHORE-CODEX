import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createHiringJob: vi.fn(),
  updateHiringJob: vi.fn(),
  push: vi.fn(),
  refresh: vi.fn(),
  goToSignInAgain: vi.fn(),
  hasSessionEnded: vi.fn(async () => false),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('../hiring-actions', () => ({ createHiringJob: mocks.createHiringJob, updateHiringJob: mocks.updateHiringJob }))
vi.mock('@/lib/forms/session-check', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/forms/session-check')>()),
  goToSignInAgain: mocks.goToSignInAgain,
  hasSessionEnded: mocks.hasSessionEnded,
}))

import { HiringJobForm } from './hiring-job-form'
import type { HiringEditableJob } from '../hiring-repository'

const publisher = { key: 'personal', kind: 'personal' as const, id: 'user-1', name: 'Asha Recruiter', canPublish: true, blocker: null, role: null, verified: true }

function fillBasics() {
  fireEvent.change(screen.getByRole('textbox', { name: 'Job title' }), { target: { value: 'Master' } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: 'Command a tanker.' } })
  // Round H (H7): descriptions need at least 120 characters.
  fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Full command of a product tanker on a nine-month contract, responsible for safe navigation, cargo operations and the crew.' } })
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

  it('P6: no longer offers "Other (type your own)" for a new job; ranks from other departments come from the list', () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'catering' } })
    expect(screen.queryByRole('checkbox', { name: /Other/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Type the rank / role' })).not.toBeInTheDocument()
    expect(screen.getByRole('combobox', { name: 'Add ranks from other departments' })).toBeInTheDocument()
  })

  it('P6: adds Master and Chief Officer to an HSEQ & Vetting job from the searchable list and saves all three', async () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'hseq_vetting' } })
    const search = screen.getByRole('combobox', { name: 'Add ranks from other departments' })
    fireEvent.change(search, { target: { value: 'master' } })
    expect(search).toHaveAttribute('aria-expanded', 'true')
    fireEvent.mouseDown(screen.getByRole('option', { name: /^Master \/ Captain, Deck officers/ }))
    fireEvent.change(search, { target: { value: 'chief officer' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    const chips = within(screen.getByRole('list', { name: 'Ranks added from other departments' }))
    expect(chips.getByText('Master / Captain')).toBeInTheDocument()
    expect(chips.getByText('Chief Officer')).toBeInTheDocument()

    fillBasics()
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(mocks.createHiringJob).toHaveBeenCalledTimes(1))
    const sent = mocks.createHiringJob.mock.calls[0]![0] as { departmentKey: string; acceptedRoleKeys: string[] }
    expect(sent.departmentKey).toBe('hseq_vetting')
    expect(sent.acceptedRoleKeys).toEqual(expect.arrayContaining(['master', 'chief_officer']))
  })

  it('P6: a form error keeps the ranks chosen from other departments', async () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'hseq_vetting' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'HSEQ Manager' }))
    const search = screen.getByRole('combobox', { name: 'Add ranks from other departments' })
    fireEvent.change(search, { target: { value: 'chief officer' } })
    fireEvent.keyDown(search, { key: 'Enter' })
    fillBasics()
    fireEvent.change(screen.getByRole('textbox', { name: 'Description' }), { target: { value: 'Too short.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish job' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/at least 120 characters/))
    expect(mocks.createHiringJob).not.toHaveBeenCalled()
    expect(screen.getByRole('checkbox', { name: 'HSEQ Manager' })).toBeChecked()
    expect(within(screen.getByRole('list', { name: 'Ranks added from other departments' })).getByText('Chief Officer')).toBeInTheDocument()
    expect(document.querySelector('input[type="hidden"][name="acceptedRoleKeys"][value="chief_officer"]')).not.toBeNull()
  })

  it('P6: shows other posters\' extras for the department as tick boxes, not ticked, and not under another department', () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} sharedExtras={{ hseq_vetting: [{ roleKey: 'chief_officer', timesUsed: 3 }, { roleKey: 'master', timesUsed: 1 }] }} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'hseq_vetting' } })
    const shared = within(screen.getByRole('group', { name: /Also added for this department by other posters/ }))
    const boxes = shared.getAllByRole('checkbox')
    expect(boxes.map((box) => box.getAttribute('value'))).toEqual(['chief_officer', 'master'])
    for (const box of boxes) expect(box).not.toBeChecked()
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'catering' } })
    expect(screen.queryByRole('group', { name: /Also added for this department by other posters/ })).not.toBeInTheDocument()
  })

  it('P6: keeps an older job\'s typed Other rank on show', () => {
    const initial = {
      id: 'job-9', companyId: null, status: 'published', title: 'Galley help', domain: 'sea', department: 'Catering', rank: 'Galley helper',
      vesselTypes: [], location: null, regions: [], summary: 's', description: 'd', requirements: null, experienceMinYears: null,
      experienceMaxYears: null, joiningFrom: null, joiningUntil: null, salaryMin: null, salaryMax: null, salaryCurrency: null,
      salaryPeriod: null, urgent: false, easyApply: true, applyUntil: null, certificates: [], visas: [],
      departmentKey: 'catering', acceptedRoleKeys: ['other_catering'], roleOtherText: 'Galley helper', minMatchToApply: 0,
    } satisfies HiringEditableJob
    render(<HiringJobForm mode="edit" jobId="job-9" initial={initial} />)
    expect(screen.getByRole('textbox', { name: 'Rank / role typed on this older job' })).toHaveValue('Galley helper')
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

describe('HiringJobForm rules (Round H, H7)', () => {
  it('blocks saving a short description and says why next to the field', async () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'deck_officers' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chief Officer' }))
    fillBasics()
    const description = screen.getByRole('textbox', { name: 'Description' })
    fireEvent.change(description, { target: { value: 'Full command.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Publish job' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Describe the role in at least 120 characters (13 so far).'))
    expect(mocks.createHiringJob).not.toHaveBeenCalled()
    expect(description).toHaveAttribute('aria-invalid', 'true')
    expect(description).toHaveAccessibleDescription(/At least 120 characters.*Describe the role in at least 120 characters/)
  })

  it('blocks publishing a salary minimum above the maximum and a conflicting location and region', async () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'technical_fleet' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Technical Superintendent' }))
    fillBasics()
    fireEvent.change(screen.getByRole('textbox', { name: 'Location' }), { target: { value: 'Andheri East' } })
    fireEvent.change(screen.getByRole('textbox', { name: 'Sailing regions' }), { target: { value: 'Worldwide' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Salary minimum' }), { target: { value: '90000' } })
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Salary maximum' }), { target: { value: '60000' } })
    // Hotfix P2: these rules hold on Publish; Save as draft keeps them as the "Before you publish" checklist.
    fireEvent.click(screen.getByRole('button', { name: 'Publish job' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/^2 things to fix/))
    expect(mocks.createHiringJob).not.toHaveBeenCalled()
    expect(screen.getByRole('spinbutton', { name: 'Salary maximum' })).toHaveAccessibleDescription('Maximum salary must be at least the minimum salary.')
    expect(screen.getByRole('textbox', { name: 'Sailing regions' })).toHaveAttribute('aria-invalid', 'true')
  })

  it('warns that a Master usually needs 10+ years, without blocking the save', async () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'deck_officers' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Master / Captain' }))
    fillBasics()
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Minimum years' }), { target: { value: '0' } })

    expect(screen.getByText(/Master Mariner usually needs 10\+ years of sea service; check the experience years\./)).toBeInTheDocument()
    expect(screen.getByRole('spinbutton', { name: 'Minimum years' })).not.toHaveAttribute('aria-invalid')
    fireEvent.click(screen.getByRole('button', { name: 'Publish job' }))
    await waitFor(() => expect(mocks.createHiringJob).toHaveBeenCalledTimes(1))
  })

  it('does not offer joining dates in the past', () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    const joining = document.querySelector('input[name="joiningFrom"]')!
    expect(joining).toHaveAttribute('min', new Date().toISOString().slice(0, 10))
  })
})

const longDescription = 'Full command of a product tanker on a nine-month contract, responsible for safe navigation, cargo operations and the crew.'

/** Every field of the form, filled; the description and the salary maximum are left wrong. */
function fillEverything() {
  fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'deck_officers' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Master / Captain' }))
  const typed: Array<[string, string, string]> = [
    ['textbox', 'Job title', 'Master'],
    ['textbox', 'Location', 'Singapore'],
    ['textbox', 'Summary', 'Command a product tanker.'],
    ['textbox', 'Description', 'Full command.'],
    ['textbox', 'Vessel types', 'Oil Tanker, Chemical Tanker'],
    ['spinbutton', 'Minimum years', '12'],
    ['spinbutton', 'Maximum years', '20'],
    ['textbox', 'Sailing regions', 'Worldwide'],
    ['textbox', 'Certificates', 'STCW, Advanced Oil Tanker'],
    ['textbox', 'Visa / documents note (optional)', 'US C1/D'],
    ['textbox', 'Other requirements', 'Tanker command experience.'],
    ['spinbutton', 'Salary minimum', '15000'],
    ['spinbutton', 'Salary maximum', '12000'],
    ['textbox', 'Currency', 'EUR'],
  ]
  for (const [role, name, value] of typed) fireEvent.change(screen.getByRole(role, { name }), { target: { value } })
  fireEvent.change(document.querySelector('input[name="joiningFrom"]')!, { target: { value: '2099-01-15' } })
  fireEvent.change(document.querySelector('input[name="applyUntil"]')!, { target: { value: '2099-01-01' } })
  fireEvent.change(screen.getByRole('combobox', { name: 'Salary period' }), { target: { value: 'day' } })
  fireEvent.click(screen.getByRole('checkbox', { name: 'Urgent joining' }))
  fireEvent.click(screen.getByRole('checkbox', { name: 'Easy Apply' }))
  fireEvent.change(screen.getByRole('spinbutton', { name: /Minimum match to apply/ }), { target: { value: '55' } })
  return typed
}

function expectEverythingKept(typed: Array<[string, string, string]>, overrides: Record<string, string> = {}) {
  for (const [role, name, value] of typed) {
    const element = screen.getByRole(role, { name }) as HTMLInputElement
    expect(element.value, name).toBe(overrides[name] ?? value)
  }
  expect(screen.getByRole('combobox', { name: 'Department' })).toHaveValue('deck_officers')
  expect(screen.getByRole('checkbox', { name: 'Master / Captain' })).toBeChecked()
  expect(document.querySelector('input[name="joiningFrom"]')).toHaveValue('2099-01-15')
  expect(document.querySelector('input[name="applyUntil"]')).toHaveValue('2099-01-01')
  expect(screen.getByRole('combobox', { name: 'Salary period' })).toHaveValue('day')
  expect(screen.getByRole('checkbox', { name: 'Urgent joining' })).toBeChecked()
  expect(screen.getByRole('checkbox', { name: 'Easy Apply' })).not.toBeChecked()
  expect(screen.getByRole('spinbutton', { name: /Minimum match to apply/ })).toHaveValue(55)
}

function draftJob(overrides: Partial<HiringEditableJob> = {}): HiringEditableJob {
  return {
    id: 'job-1', companyId: null, status: 'draft', title: 'Master', domain: 'sea', department: null, rank: null,
    vesselTypes: [], location: null, regions: [], summary: '', description: '', requirements: null, experienceMinYears: null,
    experienceMaxYears: null, joiningFrom: null, joiningUntil: null, salaryMin: null, salaryMax: null, salaryCurrency: 'USD',
    salaryPeriod: 'month', urgent: false, easyApply: true, applyUntil: null, certificates: [], visas: [],
    departmentKey: null, acceptedRoleKeys: [], roleOtherText: null, minMatchToApply: 70, ...overrides,
  }
}

describe('HiringJobForm never loses what was typed (hotfix P2)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('keeps every field after a blocked Publish, focuses the first error, links to each, and publishes once both are fixed', async () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    const typed = fillEverything()
    fireEvent.click(screen.getByRole('button', { name: 'Publish job' }))

    const summary = await screen.findByRole('alert')
    expect(summary).toHaveTextContent(/^2 things to fix/)
    expect(mocks.createHiringJob).not.toHaveBeenCalled()
    expectEverythingKept(typed)
    const description = screen.getByRole('textbox', { name: 'Description' })
    const salaryMax = screen.getByRole('spinbutton', { name: 'Salary maximum' })
    await waitFor(() => expect(description).toHaveFocus())
    expect(description).toHaveAttribute('aria-invalid', 'true')
    expect(salaryMax).toHaveAttribute('aria-invalid', 'true')
    const links = within(summary).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['#hiring-job-description', '#hiring-job-salaryMax'])
    fireEvent.click(links[1]!)
    expect(salaryMax).toHaveFocus()

    // Each error goes as soon as its field is fixed.
    fireEvent.change(description, { target: { value: longDescription } })
    expect(description).not.toHaveAttribute('aria-invalid')
    expect(screen.getByRole('alert')).toHaveTextContent(/^1 thing to fix/)
    fireEvent.change(salaryMax, { target: { value: '18000' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Publish job' }))
    await waitFor(() => expect(mocks.createHiringJob).toHaveBeenCalledTimes(1))
    expect(mocks.createHiringJob.mock.calls[0]![0]).toMatchObject({
      status: 'published', title: 'Master', location: 'Singapore', description: longDescription, salaryMin: 15000, salaryMax: 18000,
      salaryCurrency: 'EUR', salaryPeriod: 'day', urgent: true, easyApply: false, minMatchToApply: 55, acceptedRoleKeys: ['master'],
      vesselTypes: ['Oil Tanker', 'Chemical Tanker'], certificates: ['STCW', 'Advanced Oil Tanker'], joiningFrom: '2099-01-15',
    })
  })

  it('Save as draft with the same two mistakes saves everything and opens the draft', async () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    fillEverything()
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))

    await waitFor(() => expect(mocks.createHiringJob).toHaveBeenCalledTimes(1))
    expect(mocks.createHiringJob.mock.calls[0]![0]).toMatchObject({ status: 'draft', description: 'Full command.', salaryMin: 15000, salaryMax: 12000 })
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/hiring/jobs/job-1/edit?notice=draft'))
  })

  it('saves a draft with only a title', async () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Job title' }), { target: { value: 'Chief Engineer' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))

    await waitFor(() => expect(mocks.createHiringJob).toHaveBeenCalledTimes(1))
    expect(mocks.createHiringJob.mock.calls[0]![0]).toMatchObject({ status: 'draft', title: 'Chief Engineer', summary: '', description: '', departmentKey: null })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('names a draft after its rank when the title is empty, and asks for one of them when both are', async () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Summary' }), { target: { value: 'Kept.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Add a job title (or pick a rank) to save a draft.')
    expect(mocks.createHiringJob).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('Kept.')
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Job title' })).toHaveFocus())

    fireEvent.change(screen.getByRole('combobox', { name: 'Department' }), { target: { value: 'deck_officers' } })
    fireEvent.click(screen.getByRole('checkbox', { name: 'Chief Officer' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(mocks.createHiringJob).toHaveBeenCalledTimes(1))
    expect(mocks.createHiringJob.mock.calls[0]![0]).toMatchObject({ title: 'Chief Officer', status: 'draft' })
    expect(screen.getByRole('textbox', { name: 'Job title' })).toHaveValue('Chief Officer')
  })

  it('a saved draft shows "Before you publish" with each field marked, and Publish on it blocks with the full list', async () => {
    render(<HiringJobForm mode="edit" jobId="job-1" initial={draftJob()} publishLabel="Save and publish" notice="draft" />)
    const checklist = screen.getByRole('status', { name: /Before you publish: 3 things to fix/ })
    expect(within(checklist).getAllByRole('link').map((link) => link.textContent)).toEqual(['Department', 'Summary', 'Description'])
    expect(screen.getByText('Draft saved.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Department' })).toHaveFocus())
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveAttribute('aria-invalid', 'true')

    fireEvent.click(screen.getByRole('button', { name: 'Save and publish' }))
    expect(await screen.findByRole('alert')).toHaveTextContent(/^3 things to fix/)
    expect(mocks.updateHiringJob).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(mocks.updateHiringJob).toHaveBeenCalledWith('job-1', expect.objectContaining({ title: 'Master' }), 'save'))
  })

  it('keeps everything when the server refuses the save, and shows why at the top', async () => {
    mocks.createHiringJob.mockResolvedValue({ ok: false, error: 'Something went wrong. Please try again.' })
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    const typed = fillEverything()
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/The job wasn’t saved.*Something went wrong/)
    expectEverythingKept(typed)
    await waitFor(() => expect(screen.getByRole('alert')).toHaveFocus())
  })

  it('keeps everything when the connection drops', async () => {
    mocks.createHiringJob.mockRejectedValue(new TypeError('Failed to fetch'))
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} />)
    const typed = fillEverything()
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('We couldn’t reach Sea N Shore. Check your connection and try again.')
    expectEverythingKept(typed)
    expect(mocks.goToSignInAgain).not.toHaveBeenCalled()
  })

  it('offers to restore the local copy after a reload, and Discard forgets it', async () => {
    const first = render(<HiringJobForm mode="create" publisherOptions={[publisher]} draftOwnerId="user-1" />)
    const typed = fillEverything()
    fireEvent.blur(screen.getByRole('spinbutton', { name: /Minimum match to apply/ }))
    expect(window.localStorage.getItem('sns:form-draft:v1:hiring-job:user-1:new')).toContain('Singapore')
    first.unmount()

    const second = render(<HiringJobForm mode="create" publisherOptions={[publisher]} draftOwnerId="user-1" />)
    expect(await screen.findByText(/^Restore your unsaved job from /)).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Restore' }))
    expectEverythingKept(typed)
    expect(screen.queryByText(/^Restore your unsaved job/)).not.toBeInTheDocument()
    second.unmount()

    render(<HiringJobForm mode="create" publisherOptions={[publisher]} draftOwnerId="user-1" />)
    fireEvent.click(await screen.findByRole('button', { name: 'Discard' }))
    expect(window.localStorage.getItem('sns:form-draft:v1:hiring-job:user-1:new')).toBeNull()
    expect(screen.queryByText(/^Restore your unsaved job/)).not.toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Location' })).toHaveValue('')
  })

  it('keeps one copy per member and job, and clears it after a successful save', async () => {
    render(<HiringJobForm mode="edit" jobId="job-9" initial={draftJob({ id: 'job-9' })} publishLabel="Save and publish" draftOwnerId="user-1" />)
    fireEvent.change(screen.getByRole('textbox', { name: 'Location' }), { target: { value: 'Rotterdam' } })
    fireEvent.blur(screen.getByRole('textbox', { name: 'Location' }))
    expect(window.localStorage.getItem('sns:form-draft:v1:hiring-job:user-1:job-9')).toContain('Rotterdam')
    expect(window.localStorage.getItem('sns:form-draft:v1:hiring-job:user-1:new')).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: 'Save draft' }))
    await waitFor(() => expect(mocks.updateHiringJob).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(window.localStorage.getItem('sns:form-draft:v1:hiring-job:user-1:job-9')).toBeNull())
  })

  it('when the session has expired, keeps the copy, signs in again and restores it without asking', async () => {
    mocks.createHiringJob.mockResolvedValue({ ok: false, code: 'session_expired', error: 'Your session has expired. Sign in again to continue; what you typed is kept on this device.' })
    const first = render(<HiringJobForm mode="create" publisherOptions={[publisher]} draftOwnerId="user-1" />)
    const typed = fillEverything()
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(mocks.goToSignInAgain).toHaveBeenCalledTimes(1))
    expect(JSON.parse(window.localStorage.getItem('sns:form-draft:v1:hiring-job:user-1:new')!)).toMatchObject({ reason: 'session_expired' })
    first.unmount()

    render(<HiringJobForm mode="create" publisherOptions={[publisher]} draftOwnerId="user-1" />)
    expect(await screen.findByText(/^Restored your unsaved job from /)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
    expectEverythingKept(typed)
  })

  it('sends the member to sign in when a save fails because the session ended', async () => {
    mocks.createHiringJob.mockRejectedValue(new Error('An unexpected response was received from the server.'))
    mocks.hasSessionEnded.mockResolvedValueOnce(true)
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} draftOwnerId="user-1" />)
    fillEverything()
    fireEvent.click(screen.getByRole('button', { name: 'Save as draft' }))
    await waitFor(() => expect(mocks.goToSignInAgain).toHaveBeenCalledTimes(1))
  })

  it('warns before leaving with unsaved changes', () => {
    render(<HiringJobForm mode="create" publisherOptions={[publisher]} draftOwnerId="user-1" />)
    const event = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    fireEvent.change(screen.getByRole('textbox', { name: 'Job title' }), { target: { value: 'Master' } })
    const after = new Event('beforeunload', { cancelable: true })
    window.dispatchEvent(after)
    expect(after.defaultPrevented).toBe(true)
  })
})

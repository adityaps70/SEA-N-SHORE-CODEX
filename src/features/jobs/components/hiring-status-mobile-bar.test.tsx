import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ updateHiringApplicationStatus: vi.fn(), refresh: vi.fn() }))

vi.mock('../hiring-actions', () => ({ updateHiringApplicationStatus: mocks.updateHiringApplicationStatus }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: mocks.refresh }) }))

import { HiringStatusMobileBar } from './hiring-status-mobile-bar'

const applicationId = '33333333-3333-4333-8333-333333333333'

afterEach(() => cleanup())

describe('HiringStatusMobileBar (applicant review, phones)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.updateHiringApplicationStatus.mockResolvedValue({ ok: true })
  })

  it('shows Reject, a "…" for the other stages and Shortlist in a sticky bar', () => {
    render(<HiringStatusMobileBar applicationId={applicationId} currentStatus="applied" candidateName="Arjun Kapoor" />)

    const bar = screen.getByTestId('applicant-decision-bar')
    expect(bar.className).toContain('sticky')
    expect(bar.className).toContain('md:hidden')
    const group = within(bar).getByRole('group', { name: 'Decide on Arjun Kapoor' })
    const buttons = within(group).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)
    expect(buttons).toEqual(['Reject', 'More status options', 'Shortlist'])
  })

  it('shortlists with an optional message to the applicant after a confirmation', async () => {
    render(<HiringStatusMobileBar applicationId={applicationId} currentStatus="under_review" candidateName="Arjun Kapoor" />)

    fireEvent.click(screen.getByRole('button', { name: 'Shortlist' }))
    const sheet = screen.getByRole('dialog', { name: 'Shortlist?' })
    fireEvent.change(within(sheet).getByLabelText(/Message to the applicant/), { target: { value: 'Interview on Monday' } })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Shortlist' }))

    await waitFor(() => expect(mocks.updateHiringApplicationStatus).toHaveBeenCalledWith(applicationId, 'shortlisted', 'Interview on Monday'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.refresh).toHaveBeenCalled()
    expect(screen.getByRole('status')).toHaveTextContent('Moved to Shortlisted')
  })

  it('offers Mark reviewed, Interview and Hire from the "…" sheet', async () => {
    render(<HiringStatusMobileBar applicationId={applicationId} currentStatus="under_review" candidateName="Arjun Kapoor" />)

    fireEvent.click(screen.getByRole('button', { name: 'More status options' }))
    const menu = screen.getByRole('menu', { name: 'More status options' })
    expect(within(menu).getByRole('menuitem', { name: /Mark reviewed/ })).toBeDisabled()
    expect(within(menu).getByRole('menuitem', { name: 'Interview' })).toBeEnabled()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Hire' }))

    const sheet = screen.getByRole('dialog', { name: 'Hire?' })
    fireEvent.click(within(sheet).getByRole('button', { name: 'Hire' }))
    await waitFor(() => expect(mocks.updateHiringApplicationStatus).toHaveBeenCalledWith(applicationId, 'selected', null))
  })

  it('confirms Reject and shows a failure inside the sheet', async () => {
    mocks.updateHiringApplicationStatus.mockResolvedValue({ ok: false, error: 'This application changed. Refresh and try again.' })
    render(<HiringStatusMobileBar applicationId={applicationId} currentStatus="applied" candidateName="Arjun Kapoor" />)

    fireEvent.click(screen.getByRole('button', { name: 'Reject' }))
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Reject?' })).getByRole('button', { name: 'Reject' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This application changed.')
    expect(mocks.updateHiringApplicationStatus).toHaveBeenCalledWith(applicationId, 'rejected', null)
  })

  it('explains that a withdrawn application can no longer change', () => {
    render(<HiringStatusMobileBar applicationId={applicationId} currentStatus="withdrawn" candidateName="Arjun Kapoor" />)
    expect(screen.queryByRole('button', { name: 'Shortlist' })).toBeNull()
    expect(screen.getByText(/withdrew this application/)).toBeInTheDocument()
  })
})

import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ withdrawJobApplication: vi.fn(), startDirectConversationAction: vi.fn(), push: vi.fn(), refresh: vi.fn() }))

vi.mock('../actions', () => ({ withdrawJobApplication: mocks.withdrawJobApplication }))
vi.mock('@/features/messaging/actions', () => ({ startDirectConversationAction: mocks.startDirectConversationAction }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))

import { ApplicationRowMenu, WithdrawApplicationButton } from './application-row-menu'

const applicationId = '33333333-3333-4333-8333-333333333333'

function renderMenu(overrides: Partial<Parameters<typeof ApplicationRowMenu>[0]> = {}) {
  return render(
    <ApplicationRowMenu
      applicationId={applicationId}
      jobId="job-1"
      jobTitle="Second Engineer"
      jobOpen
      canWithdraw
      recruiter={{ profileId: 'recruiter-1', canMessage: true }}
      appliedAt="2026-09-20T10:00:00.000Z"
      events={[{ id: '1', status: 'applied', note: null, createdAt: '2026-09-20T10:00:00.000Z' }, { id: '2', status: 'under_review', note: 'Looks good', createdAt: '2026-09-22T10:00:00.000Z' }]}
      coverNote="Available now"
      {...overrides}
    />,
  )
}

afterEach(() => cleanup())

describe('application row "…" sheet (phones)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withdrawJobApplication.mockResolvedValue({ ok: true })
    mocks.startDirectConversationAction.mockResolvedValue({ ok: true, conversationId: 'conv-9' })
  })

  it('offers View job, Message recruiter, the timeline and Withdraw application', async () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Second Engineer' }))
    const menu = screen.getByRole('menu', { name: 'Actions for Second Engineer' })

    expect(within(menu).getByRole('menuitem', { name: 'View job' })).toHaveAttribute('href', '/jobs/job-1')
    expect(within(menu).getByRole('menuitem', { name: 'Withdraw application' })).toBeInTheDocument()
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Message recruiter' }))
    await waitFor(() => expect(mocks.startDirectConversationAction).toHaveBeenCalledWith('recruiter-1'))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/messages/conv-9'))
  })

  it('shows the full timeline and the cover note inside the sheet', () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Second Engineer' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Application timeline' }))
    const sheet = screen.getByRole('dialog', { name: 'Application timeline' })
    expect(within(sheet).getByText('Under review')).toBeInTheDocument()
    expect(within(sheet).getByText('Looks good')).toBeInTheDocument()
    expect(within(sheet).getByText('Available now')).toBeInTheDocument()
  })

  it('withdraws only after confirming inside the sheet', async () => {
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Second Engineer' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Withdraw application' }))
    const sheet = screen.getByRole('dialog', { name: 'Withdraw application?' })
    expect(mocks.withdrawJobApplication).not.toHaveBeenCalled()

    fireEvent.click(within(sheet).getByRole('button', { name: 'Withdraw application' }))
    await waitFor(() => expect(mocks.withdrawJobApplication).toHaveBeenCalledWith(applicationId))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('keeps the application when Keep application is chosen, and shows a refusal', async () => {
    mocks.withdrawJobApplication.mockResolvedValue({ ok: false, error: 'This application can no longer be withdrawn.' })
    renderMenu()
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Second Engineer' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Withdraw application' }))
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw application' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This application can no longer be withdrawn.')
    fireEvent.click(screen.getByRole('button', { name: 'Keep application' }))
    // Closing the sheet re-opens the menu in a transition; wait for it instead of asserting synchronously.
    expect(await screen.findByRole('menu', { name: 'Actions for Second Engineer' })).toBeInTheDocument()
  })

  it('omits Withdraw once decided, omits Message without a recruiter, and disables it until connected', () => {
    const { unmount } = renderMenu({ canWithdraw: false, recruiter: null, jobOpen: false })
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Second Engineer' }))
    expect(screen.queryByRole('menuitem', { name: 'Withdraw application' })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: /Message recruiter/ })).toBeNull()
    expect(screen.queryByRole('menuitem', { name: 'View job' })).toBeNull()
    unmount()

    renderMenu({ recruiter: { profileId: 'recruiter-1', canMessage: false } })
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Second Engineer' }))
    expect(screen.getByRole('menuitem', { name: /Message recruiter/ })).toBeDisabled()
    expect(screen.getByText('You can message accepted connections only.')).toBeInTheDocument()
  })
})

describe('desktop Withdraw button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.withdrawJobApplication.mockResolvedValue({ ok: true })
  })

  it('asks for confirmation, then withdraws', async () => {
    render(<WithdrawApplicationButton applicationId={applicationId} jobTitle="Second Engineer" />)
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(mocks.withdrawJobApplication).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw application' }))
    await waitFor(() => expect(mocks.withdrawJobApplication).toHaveBeenCalledWith(applicationId))
    expect(await screen.findByRole('status')).toHaveTextContent('Application withdrawn.')
  })
})

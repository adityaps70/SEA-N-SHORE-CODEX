import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  signOutSessionAction: vi.fn(),
  signOutOtherSessionsAction: vi.fn(),
  refresh: vi.fn(),
}))
vi.mock('../actions', () => ({
  signOutSessionAction: mocks.signOutSessionAction,
  signOutOtherSessionsAction: mocks.signOutOtherSessionsAction,
}))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))

import { SessionsList, type SessionListItem } from './sessions-list'

const sessions: SessionListItem[] = [
  { id: '11111111-1111-4111-8111-111111111111', device: 'Chrome on Windows', kind: 'computer', location: 'Kochi, India', lastActive: 'Active now', signedIn: 'Signed in 10 Oct 2026', current: true },
  { id: '22222222-2222-4222-8222-222222222222', device: 'Safari on iPhone', kind: 'phone', location: 'Location unavailable', lastActive: 'Active 3 hours ago', signedIn: 'Signed in 1 Oct 2026', current: false },
  { id: '33333333-3333-4333-8333-333333333333', device: 'Firefox on Linux', kind: 'computer', location: 'India', lastActive: 'Active 2 days ago', signedIn: 'Signed in 2 Oct 2026', current: false },
]

describe('Settings › Account › Active sessions (Round H, H3)', () => {
  beforeEach(() => vi.clearAllMocks())
  afterEach(() => cleanup())

  it('shows device, approximate location, last active and the "This device" badge', () => {
    render(<SessionsList sessions={sessions} />)
    const rows = screen.getAllByRole('listitem')
    expect(rows).toHaveLength(3)
    expect(within(rows[0]!).getByText('This device')).toBeInTheDocument()
    expect(within(rows[0]!).getByText('Kochi, India')).toBeInTheDocument()
    expect(within(rows[1]!).queryByText('This device')).not.toBeInTheDocument()
    expect(within(rows[1]!).getByText('Location unavailable')).toBeInTheDocument()
    expect(within(rows[1]!).getByText(/Active 3 hours ago/)).toBeInTheDocument()
  })

  it('asks before signing out one other device, and can be cancelled', async () => {
    mocks.signOutSessionAction.mockResolvedValue({ status: 'done', message: 'Signed out of that device.' })
    render(<SessionsList sessions={sessions} />)
    const phone = screen.getAllByRole('listitem')[1]!

    fireEvent.click(within(phone).getByRole('button', { name: 'Sign out' }))
    expect(within(phone).getByText('Sign out of Safari on iPhone? That device will need to sign in again.')).toBeInTheDocument()
    fireEvent.click(within(phone).getByRole('button', { name: 'Cancel' }))
    expect(mocks.signOutSessionAction).not.toHaveBeenCalled()

    fireEvent.click(within(phone).getByRole('button', { name: 'Sign out' }))
    fireEvent.click(within(phone).getByRole('button', { name: 'Sign out' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Signed out of that device.'))
    expect(mocks.signOutSessionAction).toHaveBeenCalledWith('22222222-2222-4222-8222-222222222222')
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('"Sign out of all other devices" asks first, says this device stays signed in, and shows errors', async () => {
    mocks.signOutOtherSessionsAction.mockResolvedValueOnce({ status: 'error', error: 'Your session expired. Please sign in again.' })
    mocks.signOutOtherSessionsAction.mockResolvedValueOnce({ status: 'done', message: 'Signed out of 2 other devices.' })
    render(<SessionsList sessions={sessions} />)

    fireEvent.click(screen.getByRole('button', { name: 'Sign out of all other devices' }))
    expect(screen.getByText(/Those 2 devices will need to sign in again\. You stay signed in here\./)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Sign out of other devices' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Your session expired. Please sign in again.'))

    fireEvent.click(screen.getByRole('button', { name: 'Sign out of other devices' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Signed out of 2 other devices.'))
    expect(mocks.signOutOtherSessionsAction).toHaveBeenCalledTimes(2)
  })

  it('offers no "all other devices" button when this is the only device', () => {
    render(<SessionsList sessions={[sessions[0]!]} />)
    expect(screen.queryByRole('button', { name: 'Sign out of all other devices' })).not.toBeInTheDocument()
  })
})

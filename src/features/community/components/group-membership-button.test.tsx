import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GroupMembershipButton } from './group-membership-button'

const mocks = vi.hoisted(() => ({
  joinGroup: vi.fn(),
  leaveGroup: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../actions', () => ({ joinGroup: mocks.joinGroup, leaveGroup: mocks.leaveGroup }))

const groupId = '22222222-2222-4222-8222-222222222222'

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('GroupMembershipButton', () => {
  it('joins a public group and shows Joined', async () => {
    mocks.joinGroup.mockResolvedValue({ ok: true, status: 'active' })
    render(<GroupMembershipButton groupId={groupId} groupName="Marine Engineers" visibility="public" initialStatus={null} role={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Join Marine Engineers' }))
    await waitFor(() => expect(screen.getByLabelText('Joined Marine Engineers')).toBeInTheDocument())
    expect(mocks.joinGroup).toHaveBeenCalledWith(groupId)
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('requests to join a private group, shows Pending and withdraws the request on a second click', async () => {
    mocks.joinGroup.mockResolvedValue({ ok: true, status: 'pending' })
    mocks.leaveGroup.mockResolvedValue({ ok: true })
    render(<GroupMembershipButton groupId={groupId} groupName="Masters" visibility="private" initialStatus={null} role={null} appearance="page" />)
    fireEvent.click(screen.getByRole('button', { name: 'Request to join Masters' }))
    const pending = await screen.findByRole('button', { name: 'Pending: withdraw your request to join Masters' })
    // The first transition may still be settling; the button is disabled while it is.
    await waitFor(() => expect(pending).toBeEnabled())
    fireEvent.click(pending)
    expect(window.confirm).toHaveBeenCalledWith('Withdraw your request to join Masters?')
    await waitFor(() => expect(screen.getByRole('button', { name: 'Request to join Masters' })).toBeInTheDocument())
    expect(mocks.leaveGroup).toHaveBeenCalledWith(groupId)
  })

  it('shows the server error and keeps the current state', async () => {
    mocks.joinGroup.mockResolvedValue({ ok: false, error: 'You were removed from this group. Ask a group admin if you would like to rejoin.' })
    render(<GroupMembershipButton groupId={groupId} groupName="Cadets" visibility="public" initialStatus={null} role={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Join Cadets' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('You were removed from this group.'))
    expect(screen.getByRole('button', { name: 'Join Cadets' })).toBeInTheDocument()
  })

  it('labels the button by the join setting (round 9C): open says Join even for private groups, approval says Request to join even for public ones', () => {
    render(<GroupMembershipButton groupId={groupId} groupName="Masters" visibility="private" joinPolicy="open" initialStatus={null} role={null} />)
    expect(screen.getByRole('button', { name: 'Join Masters' })).toBeInTheDocument()
    cleanup()
    render(<GroupMembershipButton groupId={groupId} groupName="Cadets" visibility="public" joinPolicy="approval" initialStatus={null} role={null} appearance="page" />)
    expect(screen.getByRole('button', { name: 'Request to join Cadets' })).toBeInTheDocument()
  })

  it('offers Leave group on the page for members, and no leave for the owner', () => {
    render(<GroupMembershipButton groupId={groupId} groupName="Cadets" visibility="public" initialStatus="active" role="member" appearance="page" />)
    expect(screen.getByRole('button', { name: 'Leave group' })).toHaveClass('max-md:rounded-full')
    cleanup()
    render(<GroupMembershipButton groupId={groupId} groupName="Cadets" visibility="public" initialStatus="active" role="owner" appearance="page" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByText('Owner')).toBeInTheDocument()
  })
})

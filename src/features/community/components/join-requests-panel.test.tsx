import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroupMember } from '../types'
import { JoinRequestsPanel } from './join-requests-panel'

const mocks = vi.hoisted(() => ({
  approveJoinRequest: vi.fn(),
  declineJoinRequest: vi.fn(),
  approveAllPending: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../actions', () => ({ approveJoinRequest: mocks.approveJoinRequest, declineJoinRequest: mocks.declineJoinRequest, approveAllPending: mocks.approveAllPending }))

const groupId = '22222222-2222-4222-8222-222222222222'

function request(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    profileId: 'req-1', slug: 'neha', fullName: 'Neha Rao', headline: 'Chief Officer', avatarPath: null,
    role: 'member', status: 'pending', requestedAt: '2026-09-01T00:00:00.000Z', joinedAt: null, isPlatformAdmin: false, ...overrides,
  }
}

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
})

describe('JoinRequestsPanel (round 9C)', () => {
  it('approves every waiting request at once after confirming, then clears the list', async () => {
    mocks.approveAllPending.mockResolvedValue({ ok: true, approved: 2 })
    render(<JoinRequestsPanel groupId={groupId} requests={[request(), request({ profileId: 'req-2', slug: 'ravi', fullName: 'Ravi Kumar' })]} />)
    expect(screen.getByText('2 waiting. Approved members are told at once.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Approve all pending' }))
    expect(window.confirm).toHaveBeenCalledWith('Approve all 2 waiting requests?')
    await waitFor(() => expect(mocks.approveAllPending).toHaveBeenCalledWith(groupId))
    await waitFor(() => expect(screen.getByText('No join requests waiting.')).toBeInTheDocument())
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('does nothing when the confirmation is declined, and shows the server error otherwise', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<JoinRequestsPanel groupId={groupId} requests={[request()]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve all pending' }))
    expect(mocks.approveAllPending).not.toHaveBeenCalled()

    vi.spyOn(window, 'confirm').mockReturnValue(true)
    mocks.approveAllPending.mockResolvedValue({ ok: false, error: 'Only the moderators of this group can do that.' })
    fireEvent.click(screen.getByRole('button', { name: 'Approve all pending' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Only the moderators of this group can do that.'))
    expect(screen.getByRole('button', { name: 'Approve Neha Rao' })).toBeInTheDocument()
  })
})

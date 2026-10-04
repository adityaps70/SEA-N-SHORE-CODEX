import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GroupMember } from '../types'
import { GroupMembersList } from './group-members-list'

const mocks = vi.hoisted(() => ({
  removeMember: vi.fn(),
  setMemberRole: vi.fn(),
  transferOwnership: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../actions', () => ({ removeMember: mocks.removeMember, setMemberRole: mocks.setMemberRole, transferOwnership: mocks.transferOwnership }))

const groupId = '22222222-2222-4222-8222-222222222222'

function member(overrides: Partial<GroupMember> = {}): GroupMember {
  return {
    profileId: 'owner-1', slug: 'asha', fullName: 'Asha Singh', headline: 'Master Mariner', avatarPath: null,
    role: 'owner', status: 'active', requestedAt: '2026-09-01T00:00:00.000Z', joinedAt: '2026-09-01T00:00:00.000Z', isPlatformAdmin: false, ...overrides,
  }
}

const members = [
  member(),
  member({ profileId: 'mod-1', slug: 'ravi', fullName: 'Ravi Kumar', role: 'admin' }),
  member({ profileId: 'sn-1', slug: 'sn', fullName: 'Sea Admin', role: 'member', isPlatformAdmin: true }),
  member({ profileId: 'm-1', slug: 'neha', fullName: 'Neha Rao', role: 'member' }),
]

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  mocks.transferOwnership.mockResolvedValue({ ok: true })
  mocks.setMemberRole.mockResolvedValue({ ok: true })
})

describe('GroupMembersList (round 9C)', () => {
  it('shows Owner and Moderator chips (stored role admin) and a "Sea N Shore admin" chip for platform administrators', () => {
    render(<GroupMembersList groupId={groupId} members={members} viewerId="m-1" canManage={false} />)
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]!).getByText('Owner')).toBeInTheDocument()
    expect(within(rows[1]!).getByText('Moderator')).toBeInTheDocument()
    expect(within(rows[1]!).queryByText('Admin')).not.toBeInTheDocument()
    expect(within(rows[2]!).getByText('Sea N Shore admin')).toBeInTheDocument()
    expect(within(rows[3]!).getByText('(you)')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('gives moderators Make moderator / Remove moderator / Remove from group, without Transfer ownership', () => {
    render(<GroupMembersList groupId={groupId} members={members} viewerId="mod-1" canManage />)
    const rows = screen.getAllByRole('listitem')
    expect(within(rows[0]!).queryByRole('button')).not.toBeInTheDocument()
    expect(within(rows[1]!).queryByRole('button')).not.toBeInTheDocument()
    fireEvent.click(within(rows[3]!).getByRole('button', { name: 'Actions for Neha Rao' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual(['Make moderator', 'Remove from group'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make moderator' }))
    expect(mocks.setMemberRole).toHaveBeenCalledWith({ groupId, profileId: 'm-1', role: 'admin' })
  })

  it('lets the owner demote a moderator and transfer ownership after confirming', async () => {
    render(<GroupMembersList groupId={groupId} members={members} viewerId="owner-1" canManage canTransferOwnership />)
    const rows = screen.getAllByRole('listitem')
    fireEvent.click(within(rows[1]!).getByRole('button', { name: 'Actions for Ravi Kumar' }))
    expect(screen.getAllByRole('menuitem').map((item) => item.textContent?.trim())).toEqual(['Remove moderator', 'Transfer ownership', 'Remove from group'])
    fireEvent.click(screen.getByRole('menuitem', { name: 'Transfer ownership' }))
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('Make Ravi Kumar the owner of this group?'))
    await waitFor(() => expect(mocks.transferOwnership).toHaveBeenCalledWith({ groupId, profileId: 'mod-1' }))
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalled())
  })

  it('keeps the menu action off when the confirmation is declined and shows server errors', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    render(<GroupMembersList groupId={groupId} members={members} viewerId="owner-1" canManage canTransferOwnership />)
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Neha Rao' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Transfer ownership' }))
    expect(mocks.transferOwnership).not.toHaveBeenCalled()

    mocks.setMemberRole.mockResolvedValue({ ok: false, error: 'Only the moderators of this group can do that.' })
    fireEvent.click(screen.getByRole('button', { name: 'Actions for Neha Rao' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Make moderator' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Only the moderators of this group can do that.'))
  })
})

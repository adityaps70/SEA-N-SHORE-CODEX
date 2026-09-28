import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  removeOrganizationMember: vi.fn(),
  updateOrganizationMemberRole: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }))
vi.mock('../workspace-actions', () => ({
  removeOrganizationMember: mocks.removeOrganizationMember,
  updateOrganizationMemberRole: mocks.updateOrganizationMemberRole,
}))

import { OrganizationTeamPanel, canRemoveTeamMember } from './organization-team-panel'

const members = [
  { userId: 'owner-1', fullName: 'Asha Owner', slug: 'asha', role: 'owner' as const, approvedAt: '2026-09-01T00:00:00.000Z' },
  { userId: 'admin-1', fullName: 'Ben Admin', slug: 'ben', role: 'administrator' as const, approvedAt: '2026-09-01T00:00:00.000Z' },
  { userId: 'member-1', fullName: 'Chen Member', slug: null, role: 'member' as const, approvedAt: '2026-09-01T00:00:00.000Z' },
]

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.removeOrganizationMember.mockResolvedValue({ ok: true, left: false })
})

describe('canRemoveTeamMember', () => {
  it('lets owners and administrators remove people, keeps owners safe from administrators and keeps the last owner', () => {
    expect(canRemoveTeamMember({ userId: 'admin-1', role: 'administrator' }, members[2]!, 1)).toBe(true)
    expect(canRemoveTeamMember({ userId: 'admin-1', role: 'administrator' }, members[1]!, 1)).toBe(true)
    expect(canRemoveTeamMember({ userId: 'admin-1', role: 'administrator' }, members[0]!, 2)).toBe(false)
    expect(canRemoveTeamMember({ userId: 'owner-1', role: 'owner' }, members[0]!, 1)).toBe(false)
    expect(canRemoveTeamMember({ userId: 'owner-1', role: 'owner' }, members[0]!, 2)).toBe(true)
    expect(canRemoveTeamMember({ userId: 'r-1', role: 'recruiter' }, members[2]!, 1)).toBe(false)
    expect(canRemoveTeamMember({ userId: 'x', role: null }, members[2]!, 1)).toBe(false)
  })
})

describe('OrganizationTeamPanel remove from team', () => {
  it('shows Remove from team to the owner for everyone but themselves (the last owner)', () => {
    render(<OrganizationTeamPanel companyId="c1" organizationSlug="oceanic" members={members} viewer={{ userId: 'owner-1', role: 'owner' }} />)
    expect(screen.getByRole('button', { name: 'Remove from team: Ben Admin' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove from team: Chen Member' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Asha Owner/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'More actions for Asha Owner' })).not.toBeInTheDocument()
  })

  it('offers nothing to people without a removing role, or without a viewer', () => {
    render(<OrganizationTeamPanel companyId="c1" members={members} viewer={{ userId: 'member-1', role: 'member' }} />)
    expect(screen.queryByRole('button', { name: /Remove from team|Leave team/ })).not.toBeInTheDocument()
    cleanup()
    render(<OrganizationTeamPanel companyId="c1" members={members} />)
    expect(screen.queryByRole('button', { name: /Remove from team|Leave team/ })).not.toBeInTheDocument()
  })

  it('confirms, removes the member and takes the row away', async () => {
    render(<OrganizationTeamPanel companyId="c1" organizationSlug="oceanic" members={members} viewer={{ userId: 'owner-1', role: 'owner' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove from team: Chen Member' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Chen Member?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from team' }))
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Chen Member was removed from the team.'))
    expect(mocks.removeOrganizationMember).toHaveBeenCalledWith({ companyId: 'c1', memberId: 'member-1' })
    expect(screen.queryByText('Chen Member')).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('on phones uses the row "…" sheet, and shows the server refusal', async () => {
    mocks.removeOrganizationMember.mockResolvedValue({ ok: false, error: 'Only the owner and administrators can remove team members, and only an owner can remove an owner.' })
    render(<OrganizationTeamPanel companyId="c1" members={members} viewer={{ userId: 'admin-1', role: 'administrator' }} />)
    // Administrators cannot remove the owner.
    expect(screen.queryByRole('button', { name: 'More actions for Asha Owner' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Chen Member' }))
    const sheet = screen.getByRole('menu', { name: 'Actions for Chen Member' })
    fireEvent.click(within(sheet).getByRole('menuitem', { name: 'Remove from team' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Chen Member?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove from team' }))
    await waitFor(() => expect(within(dialog).getByRole('alert')).toHaveTextContent('only an owner can remove an owner'))
    expect(screen.getByText('Chen Member')).toBeInTheDocument()
  })

  it('lets an administrator leave and sends them back to the organization page', async () => {
    mocks.removeOrganizationMember.mockResolvedValue({ ok: true, left: true })
    render(<OrganizationTeamPanel companyId="c1" organizationSlug="oceanic" members={members} viewer={{ userId: 'admin-1', role: 'administrator' }} />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave team: Ben Admin' }))
    const dialog = screen.getByRole('dialog', { name: 'Leave this team?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave team' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/organizations/oceanic'))
  })
})

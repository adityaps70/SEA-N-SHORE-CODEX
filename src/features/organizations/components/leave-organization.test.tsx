import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getLeaveOrganizationState: vi.fn(),
  leaveOrganization: vi.fn(),
  transferOrganizationOwnership: vi.fn(),
  push: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: vi.fn() }) }))
vi.mock('../membership-actions', () => ({
  getLeaveOrganizationState: mocks.getLeaveOrganizationState,
  leaveOrganization: mocks.leaveOrganization,
  transferOrganizationOwnership: mocks.transferOrganizationOwnership,
}))

import {
  LeaveOrganizationButton,
  LeaveOrganizationMenuHost,
  ORGANIZATION_LEAVE_OPEN_EVENT,
  OrganizationCardMenu,
} from './leave-organization'

const companyId = '33333333-3333-4333-8333-333333333333'
const base = { companyId, slug: 'fixture-organization', name: 'Fixture Lines' }

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.getLeaveOrganizationState.mockResolvedValue({ ok: true, state: { ...base, role: 'recruiter', lastOwner: false, administrators: [] } })
  mocks.leaveOrganization.mockResolvedValue({ ok: true })
})

describe('Leave organization (round F, F2)', () => {
  it('explains what changes in an in-page dialog, then leaves and returns to Organizations', async () => {
    render(<LeaveOrganizationButton companyId={companyId} organizationName="Fixture Lines" />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave organization' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Leave Fixture Lines?' })
    expect(await within(dialog).findByText('You are a Recruiter / HR here.')).toBeInTheDocument()
    expect(within(dialog).getByText(/You lose your role and the workspace tools/)).toBeInTheDocument()
    expect(within(dialog).getByText(/You can ask to join again later/)).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Leave organization' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/organizations'))
    expect(mocks.leaveOrganization).toHaveBeenCalledWith({ companyId })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('cancelling changes nothing', async () => {
    render(<LeaveOrganizationButton companyId={companyId} organizationName="Fixture Lines" />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave organization' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave Fixture Lines?' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(mocks.leaveOrganization).not.toHaveBeenCalled()
  })

  it('asks the last owner to transfer ownership first, with a picker of administrators, then lets them leave', async () => {
    mocks.getLeaveOrganizationState
      .mockResolvedValueOnce({ ok: true, state: { ...base, role: 'owner', lastOwner: true, administrators: [{ profileId: 'admin-1', fullName: 'Fixture Admin' }, { profileId: 'admin-2', fullName: 'Fixture Deputy' }] } })
      .mockResolvedValueOnce({ ok: true, state: { ...base, role: 'administrator', lastOwner: false, administrators: [] } })
    mocks.transferOrganizationOwnership.mockResolvedValue({ ok: true })
    render(<LeaveOrganizationButton companyId={companyId} organizationName="Fixture Lines" />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave organization' }))

    const dialog = await screen.findByRole('alertdialog', { name: 'Transfer ownership first' })
    expect(within(dialog).queryByRole('button', { name: 'Leave organization' })).not.toBeInTheDocument()
    const picker = within(dialog).getByRole('combobox', { name: 'New owner' })
    fireEvent.change(picker, { target: { value: 'admin-2' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Transfer ownership' }))

    await waitFor(() => expect(mocks.transferOrganizationOwnership).toHaveBeenCalledWith({ companyId, newOwnerId: 'admin-2' }))
    const leave = await screen.findByRole('alertdialog', { name: 'Leave Fixture Lines?' })
    expect(await within(leave).findByText('You are an Administrator here.')).toBeInTheDocument()
  })

  it('tells the last owner of an organization with no administrator how to add one', async () => {
    mocks.getLeaveOrganizationState.mockResolvedValue({ ok: true, state: { ...base, role: 'owner', lastOwner: true, administrators: [] } })
    render(<LeaveOrganizationButton companyId={companyId} organizationName="Fixture Lines" />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave organization' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Transfer ownership first' })
    expect(within(dialog).getByText(/has no administrator yet/)).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Transfer ownership' })).not.toBeInTheDocument()
  })

  it('switches to the transfer step when the server refuses the last owner', async () => {
    mocks.getLeaveOrganizationState
      .mockResolvedValueOnce({ ok: true, state: { ...base, role: 'owner', lastOwner: false, administrators: [] } })
      .mockResolvedValueOnce({ ok: true, state: { ...base, role: 'owner', lastOwner: true, administrators: [{ profileId: 'admin-1', fullName: 'Fixture Admin' }] } })
    mocks.leaveOrganization.mockResolvedValue({ ok: false, code: 'last_owner', error: 'You are the only owner. Transfer ownership to an administrator first.' })
    render(<LeaveOrganizationButton companyId={companyId} organizationName="Fixture Lines" />)
    fireEvent.click(screen.getByRole('button', { name: 'Leave organization' }))
    const dialog = await screen.findByRole('alertdialog', { name: 'Leave Fixture Lines?' })
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Leave organization' }))
    expect(await screen.findByRole('alertdialog', { name: 'Transfer ownership first' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('Transfer ownership to an administrator first.')
    expect(mocks.push).not.toHaveBeenCalled()
  })

  it('opens from the ⋯ menu on a Your pages card', async () => {
    render(<OrganizationCardMenu companyId={companyId} organizationName="Fixture Lines" />)
    const trigger = screen.getByRole('button', { name: 'More actions for Fixture Lines' })
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    fireEvent.click(trigger)
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('menuitem', { name: 'Leave organization' }))
    expect(await screen.findByRole('alertdialog', { name: 'Leave Fixture Lines?' })).toBeInTheDocument()
  })

  it('opens when the organization page menu asks for this organization only', async () => {
    render(<LeaveOrganizationMenuHost companyId={companyId} organizationName="Fixture Lines" />)
    act(() => { window.dispatchEvent(new CustomEvent(ORGANIZATION_LEAVE_OPEN_EVENT, { detail: 'another-organization' })) })
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    act(() => { window.dispatchEvent(new CustomEvent(ORGANIZATION_LEAVE_OPEN_EVENT, { detail: companyId })) })
    expect(await screen.findByRole('alertdialog', { name: 'Leave Fixture Lines?' })).toBeInTheDocument()
  })
})

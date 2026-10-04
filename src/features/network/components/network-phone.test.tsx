import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NetworkProfile } from '../types'
import { ManageNetworkRow } from './manage-network-row'
import { NetworkInvitationRow } from './network-invitation-row'
import { NetworkProfileCard } from './network-profile-card'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  acceptConnectionRequest: vi.fn(async () => ({ ok: true })),
  declineConnectionRequest: vi.fn(async () => ({ ok: true })),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }))
vi.mock('../actions', () => ({
  acceptConnectionRequest: mocks.acceptConnectionRequest,
  declineConnectionRequest: mocks.declineConnectionRequest,
}))
vi.mock('./connection-primary-action', () => ({
  ConnectionPrimaryAction: () => <button type="button">Connect</button>,
}))

const connectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const profile: NetworkProfile = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'capt-meera-nair',
  profileType: 'seafarer',
  fullName: 'Capt. Meera Nair',
  avatarPath: null,
  location: 'Mumbai, India',
  headline: 'Master Mariner | Tanker Operations',
  summary: null,
  rank: 'Master',
  currentCompany: 'Ocean Example',
  currentVessel: null,
  sailingExperienceYears: 18,
  vesselTypes: [],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: [],
  relationship: { following: false, connection: { kind: 'incoming_pending', connectionId } },
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('phone network surfaces', () => {
  it('accepts an invitation from the round ✓ button', async () => {
    const user = userEvent.setup()
    render(<NetworkInvitationRow profile={profile} />)
    expect(screen.getByText('Master · Ocean Example')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Accept invitation from Capt. Meera Nair' }))
    await waitFor(() => expect(mocks.acceptConnectionRequest).toHaveBeenCalledWith(connectionId))
    expect(await screen.findByRole('status')).toHaveTextContent('Connected')
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('declines an invitation from the round ✕ button', async () => {
    const user = userEvent.setup()
    render(<NetworkInvitationRow profile={profile} />)
    await user.click(screen.getByRole('button', { name: 'Decline invitation from Capt. Meera Nair' }))
    await waitFor(() => expect(mocks.declineConnectionRequest).toHaveBeenCalledWith(connectionId))
    expect(await screen.findByRole('status')).toHaveTextContent('Declined')
  })

  it('shows an error and keeps the buttons when the response fails', async () => {
    mocks.acceptConnectionRequest.mockResolvedValueOnce({ ok: false, error: 'This interaction is not available.' } as never)
    const user = userEvent.setup()
    render(<NetworkInvitationRow profile={profile} />)
    await user.click(screen.getByRole('button', { name: 'Accept invitation from Capt. Meera Nair' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This interaction is not available.')
    expect(screen.getByRole('button', { name: 'Accept invitation from Capt. Meera Nair' })).toBeInTheDocument()
  })

  it('opens Manage my network with the existing network views and Pages', async () => {
    const user = userEvent.setup()
    render(<ManageNetworkRow incomingRequestCount={3} />)
    await user.click(screen.getByRole('button', { name: 'Manage my network' }))

    const sheet = screen.getByRole('dialog', { name: 'Manage my network' })
    expect(sheet).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Connections' })).toHaveAttribute('href', '/network?tab=connections')
    expect(screen.getByRole('link', { name: 'Following & followers' })).toHaveAttribute('href', '/network?tab=following')
    expect(screen.getByRole('link', { name: /Invitations/ })).toHaveAttribute('href', '/network?tab=requests')
    expect(screen.getByRole('link', { name: /Invitations/ })).toHaveTextContent('3')
    expect(screen.getByRole('link', { name: 'Pages' })).toHaveAttribute('href', '/organizations')

    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog', { name: 'Manage my network' })).not.toBeInTheDocument()
  })

  it('compacts the suggestion card on phones while keeping the desktop card', () => {
    render(<NetworkProfileCard profile={{ ...profile, relationship: { following: false, connection: { kind: 'none', connectionId: null } } }} />)
    const card = screen.getByTestId('network-profile-card')
    expect(card).toHaveClass('min-h-[23rem]', 'max-md:min-h-0')
    // The dismiss control keeps a 44px touch target on phones.
    expect(screen.getByRole('button', { name: 'Dismiss Capt. Meera Nair suggestion' })).toHaveClass('max-md:size-11')
  })
})

import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NetworkProfile } from '../types'
import { NetworkProfileCard } from './network-profile-card'

vi.mock('./connection-primary-action', () => ({
  ConnectionPrimaryAction: () => <button type="button">Connect</button>,
}))

vi.mock('@/features/messaging/components/start-conversation-button', () => ({
  StartConversationButton: ({ targetProfileId }: { targetProfileId: string }) => (
    <button type="button" data-testid="message-cta">Message {targetProfileId}</button>
  ),
}))

const profile: NetworkProfile = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'capt-meera-nair',
  profileType: 'seafarer',
  fullName: 'Capt. Meera Nair',
  avatarPath: null,
  location: 'Mumbai, India',
  headline: 'Master Mariner | Tanker Operations',
  summary: 'Maritime professional focused on safe tanker operations.',
  rank: 'Master',
  currentCompany: 'Ocean Example',
  currentVessel: null,
  sailingExperienceYears: 18,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: false,
  availability: 'Available for mentorship',
  skills: ['SIRE 2.0', 'Navigation', 'Leadership', 'Vetting'],
  relationship: { following: false, connection: { kind: 'none', connectionId: null } },
}

afterEach(() => cleanup())

describe('NetworkProfileCard', () => {
  it('uses a LinkedIn-style suggested-person card while keeping Sea N Shore styling', async () => {
    const user = userEvent.setup()
    render(<NetworkProfileCard profile={profile} />)
    expect(screen.getByText('Capt. Meera Nair')).toBeInTheDocument()
    expect(screen.getByText('Master Mariner | Tanker Operations')).toBeInTheDocument()
    expect(screen.getByText(/Master · Ocean Example/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /dismiss capt\. meera nair suggestion/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Capt. Meera Nair' })).toHaveAttribute('href', '/people/capt-meera-nair')
    expect(screen.queryByText(/Verified|Reputation/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /dismiss capt\. meera nair suggestion/i }))
    expect(screen.queryByText('Capt. Meera Nair')).not.toBeInTheDocument()
  })

  it('keeps the primary relationship action surface available for connected profiles', () => {
    const connectedProfile: NetworkProfile = {
      ...profile,
      relationship: {
        following: false,
        connection: {
          kind: 'connected',
          connectionId: '33333333-3333-4333-8333-333333333333',
        },
      },
    }

    render(<NetworkProfileCard profile={connectedProfile} />)

    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })
})

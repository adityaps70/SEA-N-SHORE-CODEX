import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { NetworkProfile } from '../types'

const sendConnectionRequest = vi.fn<(profileId: string) => Promise<{ ok: true } | { ok: false; error: string }>>()
vi.mock('../actions', () => ({
  sendConnectionRequest: (profileId: string) => sendConnectionRequest(profileId),
  acceptConnectionRequest: vi.fn(),
}))
vi.mock('@/features/messaging/components/start-conversation-button', () => ({
  StartConversationButton: () => <button type="button">Message</button>,
}))

const { PeopleYouMayKnow } = await import('./people-you-may-know')

beforeEach(() => {
  sendConnectionRequest.mockReset()
  sendConnectionRequest.mockResolvedValue({ ok: true })
})
afterEach(() => cleanup())

function cardNames() {
  return screen.getAllByTestId('people-you-may-know-card').map((card) => within(card).getByText(/^Member \d+$/).textContent)
}

function makeProfile(index: number): NetworkProfile {
  return {
    id: `22222222-2222-4222-8222-22222222222${index}`,
    slug: `member-${index}`,
    profileType: 'seafarer',
    fullName: `Member ${index}`,
    avatarPath: index === 1 ? 'profiles/member-1/avatar.webp' : null,
    avatarUrl: index === 1 ? 'https://media.example.test/member-1.webp?signature=signed' : null,
    location: 'Mumbai, India',
    headline: `Master Mariner ${index}`,
    summary: `Short professional summary ${index}`,
    rank: 'Master',
    currentCompany: 'Example Shipping',
    currentVessel: null,
    sailingExperienceYears: 18,
    vesselTypes: ['Oil Tanker'],
    tradingAreas: ['Worldwide'],
    shoreCareerPreference: false,
    availability: null,
    skills: ['SIRE 2.0'],
    relationship: { following: false, connection: { kind: 'none', connectionId: null } },
  }
}

describe('PeopleYouMayKnow', () => {
  it('shows only three compact profiles with signed photo/about text, Connect and View profile', () => {
    render(<PeopleYouMayKnow profiles={[1, 2, 3, 4].map(makeProfile)} />)

    expect(screen.getByRole('heading', { name: /People you may know/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Member 1 profile' })).toHaveAttribute('src', 'https://media.example.test/member-1.webp?signature=signed')
    expect(screen.getByRole('img', { name: 'Member 1 profile' })).not.toHaveAttribute('src', 'profiles/member-1/avatar.webp')
    expect(screen.getByText('Short professional summary 1')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /View profile/i })).toHaveLength(3)
    expect(screen.getByText('Member 3')).toBeInTheDocument()
    expect(screen.queryByText('Member 4')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Connect with Member \d$/ })).toHaveLength(3)
  })

  it('replaces a card at once on Connect, and after 5 Connects in a row still shows 3 new people', async () => {
    render(<PeopleYouMayKnow profiles={[1, 2, 3, 4, 5, 6, 7, 8].map(makeProfile)} />)
    expect(cardNames()).toEqual(['Member 1', 'Member 2', 'Member 3'])

    for (let index = 1; index <= 5; index += 1) {
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: `Connect with Member ${index}` }))
      })
    }

    expect(sendConnectionRequest.mock.calls.map(([id]) => id)).toEqual([1, 2, 3, 4, 5].map((index) => makeProfile(index).id))
    expect(cardNames()).toEqual(['Member 6', 'Member 7', 'Member 8'])
    expect(screen.queryByTestId('suggestions-empty')).not.toBeInTheDocument()
  })

  it('brings the card back with the error when the server refuses the request', async () => {
    sendConnectionRequest.mockResolvedValueOnce({ ok: false, error: 'Request already sent.' })
    render(<PeopleYouMayKnow profiles={[1, 2, 3, 4].map(makeProfile)} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect with Member 1' }))
    })

    expect(cardNames()).toEqual(['Member 1', 'Member 2', 'Member 3'])
    expect(screen.getByRole('alert')).toHaveTextContent('Request already sent.')
  })

  it('shows the "seen everyone" empty state instead of repeating people', async () => {
    render(<PeopleYouMayKnow profiles={[1].map(makeProfile)} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect with Member 1' }))
    })

    expect(screen.queryAllByTestId('people-you-may-know-card')).toHaveLength(0)
    expect(screen.getByText('You’ve seen everyone we can suggest for now')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Invite colleagues' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Search people' })).toHaveAttribute('href', '/search?type=people')
  })

  it('shows the empty state when nobody is eligible', () => {
    render(<PeopleYouMayKnow profiles={[]} />)
    expect(screen.getByText('You’ve seen everyone we can suggest for now')).toBeInTheDocument()
  })

  it('never shows organisation profiles or the profile being viewed', () => {
    const organisation = { ...makeProfile(5), identityRoot: 'organisation' as const, profileType: 'company' as const }
    render(<PeopleYouMayKnow profiles={[makeProfile(1), organisation, makeProfile(2), makeProfile(3), makeProfile(4)]} excludeProfileId={makeProfile(2).id} />)
    expect(cardNames()).toEqual(['Member 1', 'Member 3', 'Member 4'])
  })
})

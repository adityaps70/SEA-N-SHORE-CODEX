import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NetworkProfile } from '../types'

const sendConnectionRequest = vi.fn(async () => ({ ok: true as const }))
vi.mock('../actions', () => ({ sendConnectionRequest: () => sendConnectionRequest(), acceptConnectionRequest: vi.fn() }))
vi.mock('@/features/messaging/components/start-conversation-button', () => ({ StartConversationButton: () => null }))
const dismissSuggestionAction = vi.fn<(kind: string, id: string) => Promise<{ ok: true } | { ok: false; error: string }>>(async () => ({ ok: true }))
vi.mock('@/features/signals/actions', () => ({ dismissSuggestionAction: (kind: string, id: string) => dismissSuggestionAction(kind, id) }))

const { NetworkSuggestionGrid, NETWORK_DISCOVER_VISIBLE } = await import('./network-suggestion-grid')

afterEach(() => cleanup())

function person(index: number): NetworkProfile {
  return {
    id: `44444444-4444-4444-8444-${String(index).padStart(12, '0')}`,
    slug: `member-${index}`,
    profileType: 'seafarer',
    fullName: `Member ${index}`,
    avatarPath: null,
    location: null,
    headline: 'Second Officer',
    summary: null,
    rank: 'Second Officer',
    currentCompany: null,
    currentVessel: null,
    sailingExperienceYears: null,
    vesselTypes: [],
    tradingAreas: [],
    shoreCareerPreference: false,
    availability: null,
    skills: [],
    relationship: { following: false, connection: { kind: 'none', connectionId: null } },
  } as NetworkProfile
}

describe('NetworkSuggestionGrid (/network Discover)', () => {
  it(`shows ${NETWORK_DISCOVER_VISIBLE} cards and slides a spare in after Connect or X`, async () => {
    render(<NetworkSuggestionGrid profiles={Array.from({ length: NETWORK_DISCOVER_VISIBLE + 2 }, (_, index) => person(index + 1))} />)
    expect(screen.getAllByTestId('network-profile-card')).toHaveLength(NETWORK_DISCOVER_VISIBLE)
    expect(screen.queryByText(`Member ${NETWORK_DISCOVER_VISIBLE + 1}`)).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Connect with Member 1' }))
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss Member 2 suggestion' }))
    })

    expect(dismissSuggestionAction).toHaveBeenCalledWith('person', person(2).id)
    expect(screen.getAllByTestId('network-profile-card')).toHaveLength(NETWORK_DISCOVER_VISIBLE)
    expect(screen.queryByText('Member 1')).not.toBeInTheDocument()
    expect(screen.queryByText('Member 2')).not.toBeInTheDocument()
    expect(screen.getByText(`Member ${NETWORK_DISCOVER_VISIBLE + 2}`)).toBeInTheDocument()
  })

  it('brings a dismissed card back with the error when saving fails', async () => {
    dismissSuggestionAction.mockResolvedValueOnce({ ok: false, error: 'We could not hide this suggestion. Please try again.' })
    render(<NetworkSuggestionGrid profiles={[person(1), person(2)]} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Dismiss Member 1 suggestion' }))
    })
    expect(screen.getByText('Member 1')).toBeInTheDocument()
  })

  it('shows the empty state when nobody is eligible', () => {
    render(<NetworkSuggestionGrid profiles={[]} />)
    expect(screen.getByText('You’ve seen everyone we can suggest for now')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Search people' })).toBeInTheDocument()
  })
})

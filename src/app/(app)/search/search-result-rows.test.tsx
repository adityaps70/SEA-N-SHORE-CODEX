import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { NetworkProfile } from '@/features/network/types'
import { SearchPersonRow } from './search-result-rows'

vi.mock('@/features/network/components/person-card-actions', () => ({ PersonCardActions: () => <div>Actions</div> }))

const profile: NetworkProfile = {
  id: '22222222-2222-4222-8222-222222222222',
  slug: 'placeholder-member',
  profileType: 'seafarer',
  fullName: 'Placeholder Member',
  avatarPath: null,
  location: 'Mumbai, India',
  headline: 'Chief Engineer',
  summary: null,
  rank: 'Chief Engineer',
  currentCompany: 'Ocean Example',
  currentVessel: null,
  sailingExperienceYears: 18,
  vesselTypes: [],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: [],
  relationship: { following: false, connection: { kind: 'none', connectionId: null } },
}

afterEach(() => cleanup())

describe('SearchPersonRow (round H, H7)', () => {
  it('shows the role once when the headline is the rank', () => {
    render(<ul><SearchPersonRow profile={profile} /></ul>)
    expect(screen.getAllByText(/Chief Engineer/)).toHaveLength(1)
    expect(screen.getByText('Ocean Example · Mumbai, India')).toBeInTheDocument()
  })

  it('keeps the rank in the context line when the headline says something else', () => {
    render(<ul><SearchPersonRow profile={{ ...profile, headline: 'LNG carrier specialist' }} /></ul>)
    expect(screen.getByText('Chief Engineer · Ocean Example · Mumbai, India')).toBeInTheDocument()
  })
})

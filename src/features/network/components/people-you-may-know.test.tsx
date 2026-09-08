import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { NetworkProfile } from '../types'
import { PeopleYouMayKnow } from './people-you-may-know'

function makeProfile(index: number): NetworkProfile {
  return {
    id: `22222222-2222-4222-8222-22222222222${index}`,
    slug: `member-${index}`,
    profileType: 'seafarer',
    fullName: `Member ${index}`,
    avatarPath: index === 1 ? '/media/member-1.webp' : null,
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
  it('shows only three compact profiles with photo/about text and a direct View profile action', () => {
    render(<PeopleYouMayKnow profiles={[1, 2, 3, 4].map(makeProfile)} />)

    expect(screen.getByRole('heading', { name: /People you may know/i })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Member 1 profile' })).toHaveAttribute('src', '/media/member-1.webp')
    expect(screen.getByText('Short professional summary 1')).toBeInTheDocument()
    expect(screen.getAllByRole('link', { name: /View profile/i })).toHaveLength(3)
    expect(screen.getByText('Member 3')).toBeInTheDocument()
    expect(screen.queryByText('Member 4')).not.toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { PublicProfile } from '../types'
import { MaritimeProfileCard } from './maritime-profile-card'
import { ProfileAbout } from './profile-about'

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  fullName: 'Member A',
  avatarPath: null,
  avatarUrl: null,
  coverPath: null,
  coverUrl: null,
  location: 'Mumbai, India',
  headline: 'Chief Officer | Tankers',
  summary: 'Experienced maritime professional with tanker operations experience.',
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
  currentVessel: 'MT Example',
  sailingExperienceYears: 12,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: true,
  availability: 'Available now',
  skills: ['SIRE 2.0'],
} satisfies PublicProfile

afterEach(() => cleanup())

describe('own profile section controls', () => {
  it('gives About its own edit link', () => {
    render(<ProfileAbout profile={profile} editHref="/profile/edit#about" />)
    expect(screen.getByRole('link', { name: 'Edit About' })).toHaveAttribute('href', '/profile/edit#about')
  })

  it('gives Professional Record its own edit link', () => {
    render(<MaritimeProfileCard profile={profile} editHref="/profile/edit#professional" />)
    expect(screen.getByRole('link', { name: 'Edit Professional Record' })).toHaveAttribute('href', '/profile/edit#professional')
  })
})

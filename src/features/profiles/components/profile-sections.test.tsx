import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicProfile } from '../types'
import { MaritimeProfileCard } from './maritime-profile-card'
import { ProfileAbout } from './profile-about'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

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
  availability: 'YES',
  skills: ['SIRE 2.0'],
} satisfies PublicProfile

afterEach(() => cleanup())

describe('own profile section controls', () => {
  it('edits About in place', () => {
    render(<ProfileAbout profile={profile} editHref="/profile/edit#about" />)
    const edit = screen.getByRole('button', { name: 'Edit About' })
    fireEvent.click(edit)
    expect(screen.getByRole('textbox', { name: 'About' })).toHaveValue(profile.summary)
    expect(screen.getByRole('textbox', { name: 'Skills' })).toHaveValue('SIRE 2.0')
  })

  it('edits Professional Record in place with Onboard and Ashore availability only', () => {
    render(<MaritimeProfileCard profile={profile} editHref="/profile/edit#professional" />)
    const edit = screen.getByRole('button', { name: 'Edit Professional Record' })
    fireEvent.click(edit)
    const availability = screen.getByRole('combobox', { name: 'Availability' })
    expect(availability).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Onboard' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Ashore' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'YES' })).not.toBeInTheDocument()
  })
})

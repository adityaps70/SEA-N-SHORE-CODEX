import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { OwnProfile } from '../types'
import { ProfileEditForm } from './profile-edit-form'

vi.mock('../actions', () => ({
  updateProfile: vi.fn(async () => ({})),
}))

const profile: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'captain-example',
  profileType: 'seafarer',
  fullName: 'Captain Example',
  avatarPath: null,
  location: 'Mumbai',
  headline: 'Master Mariner',
  summary: 'Experienced maritime professional.',
  rank: 'Master',
  currentCompany: 'Example Shipping',
  currentVessel: 'MV Example',
  sailingExperienceYears: 18,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: false,
  availability: 'Open to mentoring',
  skills: ['Navigation', 'SIRE 2.0'],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-01T00:00:00.000Z',
}

describe('ProfileEditForm', () => {
  it('prefills editable profile fields and keeps the stored profile type fixed', () => {
    const { container } = render(<ProfileEditForm profile={profile} />)

    expect(screen.getByRole('textbox', { name: /full name/i })).toHaveValue('Captain Example')
    expect(screen.getByRole('textbox', { name: /profile address/i })).toHaveValue('captain-example')
    expect(screen.getByRole('textbox', { name: /^headline$/i })).toHaveValue('Master Mariner')
    expect(screen.getByRole('textbox', { name: /skills/i })).toHaveValue('Navigation, SIRE 2.0')
    expect(screen.getByRole('textbox', { name: /^rank$/i })).toHaveValue('Master')

    const profileType = container.querySelector<HTMLInputElement>('input[name="profileType"]')
    expect(profileType).toHaveValue('seafarer')
    expect(screen.queryByRole('combobox', { name: /profile type/i })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /cancel/i })).toHaveAttribute('href', '/profile')
  })
})

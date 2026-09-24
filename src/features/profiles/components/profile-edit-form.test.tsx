import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OwnProfile } from '../types'
import { ProfileEditForm } from './profile-edit-form'

vi.mock('../actions', () => ({
  updateProfile: vi.fn(async () => ({})),
}))

const profile: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'captain-example',
  profileType: 'seafarer',
  identityRoot: 'professional',
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

afterEach(() => cleanup())

describe('ProfileEditForm', () => {
  it('prefills editable profile fields and keeps the stored profile type fixed', () => {
    const { container } = render(<ProfileEditForm profile={profile} />)

    expect(screen.getByRole('textbox', { name: /full name/i })).toHaveValue('Captain Example')
    expect(screen.getByRole('textbox', { name: /username/i })).toHaveValue('captain-example')
    expect(screen.getByText('Username changes remaining: 2 of 2.')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: /^headline$/i })).toHaveValue('Master Mariner')
    expect(screen.getByRole('textbox', { name: /skills/i })).toHaveValue('Navigation, SIRE 2.0')
    expect(screen.getByRole('textbox', { name: /^rank$/i })).toHaveValue('Master')

    const profileType = container.querySelector<HTMLInputElement>('input[name="profileType"]')
    expect(profileType).toHaveValue('seafarer')
    expect(screen.queryByRole('combobox', { name: /profile type/i })).not.toBeInTheDocument()

    expect(screen.getByRole('button', { name: /save changes/i })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /cancel/i })).toHaveAttribute('href', '/profile')
  })

  it('keeps current company editable for professional identities with non-maritime legacy profile types', () => {
    render(<ProfileEditForm profile={{ ...profile, profileType: 'mentor', identityRoot: 'professional' }} />)

    expect(screen.getByRole('textbox', { name: /current company/i })).toHaveValue('Example Shipping')
  })
  it('shows company name for Shipowner organisation identities', () => {
    render(
      <ProfileEditForm
        profile={{
          ...profile,
          profileType: 'company',
          identityRoot: 'organisation',
          primaryIdentity: 'Shipowner',
          fullName: 'Aditya Pratap Singh',
          currentCompany: 'Beaufort Marine Services',
        }}
      />,
    )

    expect(screen.getByRole('textbox', { name: 'Company name' })).toHaveValue('Beaufort Marine Services')
  })

})

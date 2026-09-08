import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicProfile } from '../types'
import { ProfileHeader } from './profile-header'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

const profile: PublicProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  identityRoot: 'professional',
  primaryIdentity: 'Chief Engineer',
  primaryIdentityFamily: 'Sea-going · Engine',
  secondaryIdentities: ['Mentor', 'ISM Auditor'],
  fullName: 'Member A',
  avatarPath: 'profiles/member-a/avatar.webp',
  avatarUrl: 'https://media.example/avatar.webp',
  coverPath: 'profiles/member-a/cover.webp',
  coverUrl: 'https://media.example/cover.webp',
  location: 'Mumbai, India',
  headline: 'Chief Officer | Tankers',
  summary: 'Experienced maritime professional.',
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
  currentVessel: 'MT Example',
  sailingExperienceYears: 12,
  vesselTypes: ['Oil Tanker'],
  tradingAreas: ['Worldwide'],
  shoreCareerPreference: true,
  availability: 'YES',
  skills: ['SIRE 2.0'],
}

afterEach(() => cleanup())

describe('ProfileHeader', () => {
  it('renders identity, profile photo and cover photo', () => {
    render(<ProfileHeader profile={profile} />)
    expect(screen.getByRole('heading', { name: 'Member A' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Member A profile photo' })).toHaveAttribute('src', profile.avatarUrl)
    expect(screen.getByRole('img', { name: 'Member A cover photo' })).toHaveAttribute('src', profile.coverUrl)
    expect(screen.getByText('Chief Officer | Tankers')).toBeInTheDocument()
    expect(screen.queryByText('YES')).not.toBeInTheDocument()
  })

  it('prefers the exact onboarding identity and shows additional capacities', () => {
    render(<ProfileHeader profile={profile} />)
    expect(screen.getByText('Chief Engineer')).toBeInTheDocument()
    expect(screen.getByText('Mentor')).toBeInTheDocument()
    expect(screen.getByText('ISM Auditor')).toBeInTheDocument()
    expect(screen.queryByText('Seafarer')).not.toBeInTheDocument()
  })

  it('opens basic information editing inline instead of navigating away', () => {
    render(
      <ProfileHeader
        profile={profile}
        editHref="/profile/edit#identity"
        mediaControls={<button type="button">Change cover photo</button>}
        avatarControls={<button type="button">Change profile photo</button>}
      />,
    )

    const edit = screen.getByRole('button', { name: 'Edit basic information' })
    expect(edit).toBeInTheDocument()
    fireEvent.click(edit)
    expect(screen.getByRole('textbox', { name: 'Full name' })).toHaveValue('Member A')
    expect(screen.getByRole('textbox', { name: 'Headline' })).toHaveValue('Chief Officer | Tankers')
    expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change cover photo' })).toBeInTheDocument()
  })
})

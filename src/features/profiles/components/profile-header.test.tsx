import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicProfile } from '../types'
import { ProfileHeader } from './profile-header'
import { ProfilePassportToolbar } from './profile-passport-toolbar'

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

  it('uses a LinkedIn-style stacked identity layout so actions cannot squeeze a full name', () => {
    const longNameProfile = {
      ...profile,
      fullName: 'Aditya Pratap Singh',
    }

    render(
      <ProfileHeader
        profile={longNameProfile}
        actions={
          <div aria-label="Profile actions">
            <button type="button">View public profile</button>
            <button type="button">Share profile</button>
            <button type="button">QR profile</button>
            <button type="button">Download CV</button>
          </div>
        }
      />,
    )

    const heading = screen.getByRole('heading', { name: 'Aditya Pratap Singh' })
    expect(heading).not.toHaveClass('truncate', 'break-words')
    expect(heading).toHaveClass('text-[1.75rem]', 'sm:text-[2rem]')
    expect(screen.getByTestId('profile-header-avatar')).toHaveClass('rounded-full')
    expect(screen.getByTestId('profile-header-identity')).toHaveClass('max-w-4xl')
    expect(screen.getByTestId('profile-header-actions')).toHaveClass('mt-5', 'w-full')
    expect(screen.getByTestId('profile-header-shell')).toHaveClass('overflow-visible')
    expect(screen.getByTestId('profile-header-cover')).toHaveClass('rounded-t-[1.75rem]')
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
    // The organization field is the Sea N Shore organization type-ahead.
    expect(screen.getByRole('combobox', { name: 'Current organization' })).toHaveValue('Example Shipping')
    expect(screen.getByRole('button', { name: 'Change profile photo' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Change cover photo' })).toBeInTheDocument()
  })
  it('lets the phone "…" sheet in its actions open the same inline editor, including contact visibility', () => {
    render(
      <ProfileHeader
        profile={profile}
        editHref="inline"
        contactVisibility="public"
        actions={<ProfilePassportToolbar slug={profile.slug} />}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'More profile actions' }))
    fireEvent.click(screen.getByRole('menuitem', { name: /Edit basic information/ }))
    expect(screen.getByRole('textbox', { name: 'Full name' })).toHaveValue('Member A')
    expect(screen.getByRole('combobox', { name: 'Contact visibility' })).toHaveValue('public')
  })

  it('runs the header edge to edge on phones only', () => {
    render(<ProfileHeader profile={profile} />)
    const shell = screen.getByTestId('profile-header-shell')
    expect(shell).toHaveClass('rounded-[1.75rem]', 'max-md:-mx-4', 'max-md:rounded-none')
  })

  it('does not edit legacy organization accounts through a personal profile header', () => {
    render(
      <ProfileHeader
        profile={{
          ...profile,
          profileType: 'company',
          identityRoot: 'organisation',
          primaryIdentity: 'Shipowner',
          fullName: 'Aditya Pratap Singh',
          currentCompany: 'Oceanic Shipping',
        }}
        editHref="/profile/edit#identity"
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Edit basic information' }))
    expect(screen.queryByRole('textbox', { name: 'Company name' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Current organization' })).not.toBeInTheDocument()
    expect(screen.queryByRole('combobox', { name: 'Current organization' })).not.toBeInTheDocument()
  })

  it('links the current organization to its Sea N Shore page with its logo', () => {
    render(
      <ProfileHeader
        profile={{
          ...profile,
          currentCompany: 'Oceanic Ship Management',
          currentOrganization: {
            id: '22222222-2222-4222-8222-222222222222',
            slug: 'oceanic-ship-management',
            name: 'Oceanic Ship Management',
            logoUrl: '/api/company-logo/22222222-2222-4222-8222-222222222222',
            verified: true,
          },
        }}
      />,
    )

    const link = screen.getByTestId('profile-header-organization')
    expect(link).toHaveAttribute('href', '/organizations/oceanic-ship-management')
    expect(link).toHaveTextContent('Oceanic Ship Management')
    expect(link.querySelector('img')).toHaveAttribute('src', '/api/company-logo/22222222-2222-4222-8222-222222222222')
    expect(screen.getByRole('img', { name: 'Verified organization' })).toBeInTheDocument()
  })

  it('marks an unclaimed current organization', () => {
    render(
      <ProfileHeader
        profile={{
          ...profile,
          currentOrganization: {
            id: '22222222-2222-4222-8222-222222222222',
            slug: 'harbour-crew',
            name: 'Harbour Crew',
            logoUrl: null,
            verified: false,
            unclaimed: true,
          },
        }}
      />,
    )

    expect(screen.getByTestId('profile-header-organization')).toHaveTextContent('Unclaimed')
    expect(screen.queryByRole('img', { name: 'Verified organization' })).not.toBeInTheDocument()
  })

  it('uses a work icon, not a ship, for shore personas', () => {
    const { rerender } = render(<ProfileHeader profile={{ ...profile, persona: 'shore_professional' }} />)
    expect(screen.getByTestId('profile-identity-icon')).toHaveClass('lucide-briefcase')
    rerender(<ProfileHeader profile={{ ...profile, persona: 'seafarer' }} />)
    expect(screen.getByTestId('profile-identity-icon')).toHaveClass('lucide-anchor')
    rerender(<ProfileHeader profile={{ ...profile, persona: 'trainer_instructor' }} />)
    expect(screen.getByTestId('profile-identity-icon')).toHaveClass('lucide-graduation-cap')
    rerender(<ProfileHeader profile={{ ...profile, persona: 'maritime_enthusiast' }} />)
    expect(screen.getByTestId('profile-identity-icon')).toHaveClass('lucide-compass')
  })

  it('keeps an unlinked current organization as plain text', () => {
    render(<ProfileHeader profile={profile} />)

    expect(screen.getByText('Example Shipping').closest('a')).toBeNull()
    expect(screen.queryByTestId('profile-header-organization')).not.toBeInTheDocument()
  })
})

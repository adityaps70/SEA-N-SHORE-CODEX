import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { AccessContext } from '@/features/access/policy'
import { PERSONAS } from '../persona'
import { PERSONA_ICONS, identityFamilyIcon, profileIdentityIcon } from '../persona-icons'
import type { OwnProfile } from '../types'
import { ProfileMembershipCard } from './profile-membership-card'
import { ProfileField, ProfileFieldList, ProfileSection } from './profile-section'
import { Anchor, Briefcase, Building2, GraduationCap, HeartHandshake, Landmark, UserSearch } from 'lucide-react'

afterEach(() => cleanup())

const profile: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'asha-singh',
  profileType: 'maritime_professional',
  persona: 'shore_professional',
  profileIntents: ['network', 'hire'],
  fullName: 'Asha Singh',
  avatarPath: null,
  location: 'Mumbai',
  headline: 'Fleet Personnel Manager',
  summary: null,
  rank: null,
  currentCompany: 'Oceanic Ship Management',
  currentOrganization: {
    id: '22222222-2222-4222-8222-222222222222',
    slug: 'oceanic-ship-management',
    name: 'Oceanic Ship Management',
    logoUrl: null,
    verified: false,
    unclaimed: true,
  },
  currentVessel: null,
  sailingExperienceYears: null,
  vesselTypes: [],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: [],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-01T00:00:00.000Z',
}

const access: AccessContext = {
  personalPlan: 'free',
  personalEntitlements: [],
  verifications: ['recruiter'],
  organizationMemberships: [],
  accountActive: true,
}

describe('shared profile section style', () => {
  it('uses one heading, label and value style', () => {
    render(
      <ProfileSection id="demo" title="Demo section" description="What this section is for.">
        <ProfileFieldList>
          <ProfileField label="Rank">Master</ProfileField>
        </ProfileFieldList>
      </ProfileSection>,
    )

    const section = screen.getByRole('region', { name: 'Demo section' })
    expect(within(section).getByRole('heading', { level: 2, name: 'Demo section' })).toHaveClass('text-lg', 'font-bold', 'text-navy-950')
    expect(within(section).getByText('Rank')).toHaveClass('text-xs', 'font-semibold', 'uppercase', 'tracking-wide', 'text-muted')
    expect(within(section).getByText('Master')).toHaveClass('text-sm', 'text-ink')
  })
})

describe('Access & goals', () => {
  it('separates the section title, panel headings, labels and values', () => {
    render(<ProfileMembershipCard profile={profile} access={access} />)

    const section = screen.getByRole('region', { name: 'Access & goals' })
    expect(within(section).getByRole('heading', { level: 2, name: 'Access & goals' })).toHaveClass('text-lg', 'font-bold')
    for (const panel of ['Profile', 'Plan', 'Verifications']) {
      expect(within(section).getByRole('heading', { level: 3, name: panel })).toHaveClass('text-sm', 'font-bold', 'text-navy-950')
    }
    expect(within(section).getByText('Profile type')).toHaveClass('uppercase', 'text-muted')
    expect(within(section).getByText('Shore Professional')).toHaveClass('text-sm', 'text-ink')
    expect(within(section).getByText('Personal plan')).toHaveClass('uppercase', 'text-muted')
    expect(within(section).getByText('Hire people')).toBeInTheDocument()
    expect(within(section).getByText('Verified Recruiter')).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Oceanic Ship Management' })).toHaveAttribute('href', '/organizations/oceanic-ship-management')
    expect(within(section).getByText('Unclaimed')).toBeInTheDocument()
    expect(within(section).getByRole('link', { name: 'Edit profile & goals' })).toHaveAttribute('href', '/profile/edit')
  })
})

describe('persona icons', () => {
  it('gives only sea-going personas a shipping icon', () => {
    expect(PERSONA_ICONS.seafarer).toBe(Anchor)
    expect(PERSONA_ICONS.shore_professional).toBe(Briefcase)
    expect(PERSONA_ICONS.recruiter_hr).toBe(UserSearch)
    expect(PERSONA_ICONS.trainer_instructor).toBe(GraduationCap)
    expect(PERSONA_ICONS.seafarer_family).toBe(HeartHandshake)
    for (const persona of PERSONAS.filter((entry) => entry !== 'seafarer')) {
      expect(PERSONA_ICONS[persona]).not.toBe(Anchor)
    }
  })

  it('maps legacy identity families to relevant icons', () => {
    expect(identityFamilyIcon('Legal, Insurance & Finance')).toBe(Landmark)
    expect(identityFamilyIcon('Recruitment, Welfare & Public Sector')).toBe(UserSearch)
    expect(identityFamilyIcon('Training, Research & Human Factors')).toBe(GraduationCap)
    expect(identityFamilyIcon('Sea-going · Deck')).toBe(Anchor)
    expect(identityFamilyIcon(null)).toBeNull()
    expect(profileIdentityIcon({ identityRoot: 'organisation' })).toBe(Building2)
    expect(profileIdentityIcon({ primaryIdentityFamily: 'Legal, Insurance & Finance' })).toBe(Landmark)
    expect(profileIdentityIcon({ profileType: 'maritime_professional' })).toBe(Briefcase)
  })
})

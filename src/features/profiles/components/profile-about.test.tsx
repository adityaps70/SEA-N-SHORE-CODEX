import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PublicProfile } from '../types'
import { ProfileAbout } from './profile-about'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('../profile-inline-actions', () => ({
  updateProfileAboutSection: vi.fn(),
}))

const profile: PublicProfile = {
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
  availability: 'onboard',
  skills: ['Navigation', 'Vetting'],
}

describe('ProfileAbout', () => {
  it('uses a simple About heading and body-level Skills label', () => {
    render(<ProfileAbout profile={profile} />)

    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    expect(screen.getByText('Skills')).toBeInTheDocument()
    expect(screen.queryByText('Expertise')).not.toBeInTheDocument()
    expect(screen.getByText('Navigation')).toBeInTheDocument()
    expect(screen.getByText('Vetting')).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PublicProfile } from '../types'
import { MaritimeProfileCard } from './maritime-profile-card'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('../profile-inline-actions', () => ({
  updateProfileProfessionalSection: vi.fn(),
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
  skills: ['Navigation'],
}

describe('MaritimeProfileCard', () => {
  it('uses the simple Maritime Experience heading without a duplicate eyebrow', () => {
    render(<MaritimeProfileCard profile={profile} />)

    expect(screen.getByRole('heading', { name: 'Maritime Experience' })).toBeInTheDocument()
    expect(screen.queryByText('Professional record')).not.toBeInTheDocument()
    expect(screen.getByText('Master')).toBeInTheDocument()
    expect(screen.getByText('MV Example')).toBeInTheDocument()
  })
})

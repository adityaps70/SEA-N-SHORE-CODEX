import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { PublicProfile } from '../types'
import { ProfileHeader } from './profile-header'
import { ProfileNetworkStats } from './profile-network-stats'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../profile-inline-actions', () => ({ updateProfileIdentitySection: vi.fn() }))

afterEach(() => cleanup())

const counts = { connections: 1250, followers: 1, following: 0 }

describe('ProfileNetworkStats', () => {
  it('shows all three counts with singular labels where needed and no links when lists are private to the viewer', () => {
    render(<ProfileNetworkStats summary={{ counts, isOwner: false, canViewLists: false }} slug="asha" fullName="Asha Singh" />)

    const stats = screen.getByTestId('profile-network-stats')
    expect(stats).toHaveTextContent('1,250Connections')
    expect(stats).toHaveTextContent('1Follower')
    expect(stats).toHaveTextContent('0Following')
    expect(screen.queryByRole('link')).not.toBeInTheDocument()
    expect(screen.getByText("Only Asha's connections can see who is in these lists.")).toBeInTheDocument()
  })

  it('names the member by first name, not by a leading title such as Capt.', () => {
    render(<ProfileNetworkStats summary={{ counts, isOwner: false, canViewLists: false }} slug="capt-arjun" fullName="Capt. Arjun Rao" />)
    expect(screen.getByText("Only Arjun's connections can see who is in these lists.")).toBeInTheDocument()
  })

  it('links every count for the owner and states who else can see the lists', () => {
    render(<ProfileNetworkStats summary={{ counts, isOwner: true, canViewLists: true }} slug="asha" fullName="Asha Singh" />)
    expect(screen.getAllByRole('link')).toHaveLength(3)
    expect(screen.getByText('Your connections can see who is in these lists. Other members see only the numbers.')).toBeInTheDocument()
  })

  it('renders inside the profile header together with owner badges', () => {
    const profile = {
      id: '11111111-1111-4111-8111-111111111111',
      slug: 'asha',
      profileType: 'seafarer',
      fullName: 'Asha Singh',
      avatarPath: null,
      location: null,
      headline: null,
      summary: null,
      rank: null,
      currentCompany: null,
      currentVessel: null,
      sailingExperienceYears: null,
      vesselTypes: [],
      tradingAreas: [],
      shoreCareerPreference: false,
      availability: null,
      skills: [],
    } satisfies PublicProfile

    render(
      <ProfileHeader
        profile={profile}
        badges={<span>DG profile on file</span>}
        stats={<ProfileNetworkStats summary={{ counts, isOwner: true, canViewLists: true }} slug="asha" fullName="Asha Singh" />}
      />,
    )

    expect(screen.getByText('DG profile on file')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /1,250\s*Connections/ })).toHaveAttribute('href', '/network?tab=connections')
  })
})

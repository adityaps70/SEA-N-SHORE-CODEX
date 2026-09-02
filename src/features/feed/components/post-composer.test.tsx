import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { OwnProfile } from '@/features/profiles/types'
import { PostComposer } from './post-composer'

const refresh = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh }),
}))

vi.mock('../actions', () => ({
  createPost: vi.fn(async () => ({ ok: true })),
}))

const profile: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  fullName: 'Member A',
  avatarPath: null,
  location: 'Mumbai',
  headline: 'Chief Officer',
  summary: 'Experienced maritime professional with tanker operations experience.',
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
  currentVessel: null,
  sailingExperienceYears: 12,
  vesselTypes: [],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: ['SIRE 2.0'],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-02T10:00:00.000Z',
}

describe('PostComposer', () => {
  it('uses the approved prompt and has no AI copilot control', () => {
    render(<PostComposer profile={profile} />)
    expect(screen.getByPlaceholderText('Share a maritime update, technical lesson, or industry insight...')).toBeInTheDocument()
    expect(screen.getByLabelText('Topic')).toBeInTheDocument()
    expect(screen.getByText('Photo/Diagram')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Technical Poll' })).toBeInTheDocument()
    expect(screen.queryByText(/Co-Pilot/i)).not.toBeInTheDocument()
  })

  it('opens poll fields and keeps at least two choices', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.click(screen.getByRole('button', { name: 'Technical Poll' }))
    expect(screen.getByLabelText('Poll option 1')).toBeInTheDocument()
    expect(screen.getByLabelText('Poll option 2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add option' })).toBeInTheDocument()
  })
})

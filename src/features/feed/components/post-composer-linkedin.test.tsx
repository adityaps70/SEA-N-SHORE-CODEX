import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { OwnProfile } from '@/features/profiles/types'
import { PostComposer } from './post-composer'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}))

vi.mock('../actions', () => ({
  createPost: vi.fn(async () => ({ ok: true })),
  createPostMediaUpload: vi.fn(),
  discardPendingPostMedia: vi.fn(async () => ({ ok: true })),
}))

vi.mock('./upload-post-media', () => ({
  uploadPostMediaFile: vi.fn(),
}))

const profile: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  fullName: 'Member A',
  avatarPath: null,
  avatarUrl: 'https://media.example/member-a.jpg',
  location: 'Mumbai',
  headline: 'Chief Officer',
  summary: 'Experienced maritime professional.',
  rank: 'Chief Officer',
  currentCompany: 'Example Shipping',
  currentVessel: null,
  sailingExperienceYears: 12,
  vesselTypes: [],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: [],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-02T10:00:00.000Z',
}

afterEach(() => cleanup())

describe('PostComposer LinkedIn-style shell', () => {
  it('shows a compact Start a post trigger and opens the full composer in a dialog', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)

    expect(screen.getByRole('button', { name: /start a post/i })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Emoji$/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /start a post/i }))

    const dialog = screen.getByRole('dialog', { name: /create a post/i })
    expect(dialog).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Share your thoughts ...')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /add emoji/i })).toBeInTheDocument()
    expect(screen.getByText('Photo / Video')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Technical Poll' })).toBeInTheDocument()
  })
})

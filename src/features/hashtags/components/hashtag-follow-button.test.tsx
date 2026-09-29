import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  followHashtag: vi.fn(),
  unfollowHashtag: vi.fn(),
}))

vi.mock('../actions', () => ({ followHashtag: mocks.followHashtag, unfollowHashtag: mocks.unfollowHashtag }))

import { HashtagFollowButton } from './hashtag-follow-button'

beforeEach(() => {
  vi.clearAllMocks()
  mocks.followHashtag.mockResolvedValue({ ok: true, following: true })
  mocks.unfollowHashtag.mockResolvedValue({ ok: true, following: false })
})

afterEach(cleanup)

describe('HashtagFollowButton', () => {
  it('follows optimistically and bumps the follower count', async () => {
    const user = userEvent.setup()
    render(<HashtagFollowButton tag="sire" initialFollowing={false} initialFollowerCount={4} />)

    const button = screen.getByRole('button', { name: 'Follow #sire' })
    expect(button).toHaveAttribute('aria-pressed', 'false')
    await user.click(button)

    expect(screen.getByRole('button', { name: 'Following #sire' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('hashtag-follower-count')).toHaveTextContent('5 followers')
    await waitFor(() => expect(mocks.followHashtag).toHaveBeenCalledWith('sire'))
  })

  it('unfollows and rolls back when the action fails', async () => {
    mocks.unfollowHashtag.mockResolvedValueOnce({ ok: false, error: 'Your account cannot follow hashtags right now.' })
    const user = userEvent.setup()
    render(<HashtagFollowButton tag="sire" initialFollowing initialFollowerCount={1} />)

    await user.click(screen.getByRole('button', { name: 'Following #sire' }))

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Your account cannot follow hashtags right now.'))
    expect(screen.getByRole('button', { name: 'Following #sire' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByTestId('hashtag-follower-count')).toHaveTextContent('1 follower')
    expect(mocks.unfollowHashtag).toHaveBeenCalledWith('sire')
  })
})

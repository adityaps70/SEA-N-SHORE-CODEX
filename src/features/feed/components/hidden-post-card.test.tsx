import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HiddenPost } from '../types'
import { HiddenPostCard } from './hidden-post-card'

const mocks = vi.hoisted(() => ({ unhidePost: vi.fn(async (postId: string) => { void postId; return { ok: true as const } }) }))
vi.mock('../actions', () => ({ unhidePost: mocks.unhidePost }))

const post: HiddenPost = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  body: 'Notes from our enclosed space entry drill with the whole deck crew.',
  isRepost: false,
  createdAt: '2026-09-20T08:00:00.000Z',
  hiddenAt: '2026-09-25T08:00:00.000Z',
  author: { id: '22222222-2222-4222-8222-222222222222', slug: 'rinki-mukharjee', fullName: 'Rinki Mukharjee', avatarUrl: 'https://signed.example/rinki.webp' },
  organization: null,
  thumbnail: { url: '/api/feed-media/a/b/one.jpg', mimeType: 'image/jpeg' },
}

afterEach(() => {
  cleanup()
  mocks.unhidePost.mockClear()
})

describe('HiddenPostCard', () => {
  it('shows a compact preview: author photo and name linking to the profile, dates, first lines and thumbnail', () => {
    render(<HiddenPostCard post={post} />)

    const article = screen.getByRole('article', { name: 'Post by Rinki Mukharjee' })
    expect(screen.getByRole('link', { name: "View Rinki Mukharjee's profile" })).toHaveAttribute('href', '/people/rinki-mukharjee')
    expect(screen.getByRole('link', { name: 'Rinki Mukharjee' })).toHaveAttribute('href', '/people/rinki-mukharjee')
    expect(article).toHaveTextContent('Posted Sep 20, 2026')
    expect(article).toHaveTextContent('Hidden Sep 25, 2026')
    expect(screen.getByText(post.body)).toHaveClass('line-clamp-3')
    const thumbnail = screen.getByRole('link', { name: 'Open the post by Rinki Mukharjee' })
    expect(thumbnail).toHaveAttribute('href', `/posts/${post.id}`)
    expect(thumbnail.querySelector('img')).toHaveAttribute('src', post.thumbnail?.url)
  })

  it('shows the organization for posts published as one', () => {
    render(<HiddenPostCard post={{ ...post, thumbnail: null, organization: { id: 'c1', slug: 'nordic-lng', name: 'Nordic LNG', logoUrl: null } }} />)

    expect(screen.getByRole('link', { name: "View Nordic LNG's page" })).toHaveAttribute('href', '/organizations/nordic-lng')
    expect(screen.getByRole('link', { name: 'Nordic LNG' })).toHaveAttribute('href', '/organizations/nordic-lng')
    expect(screen.queryByRole('link', { name: /Open the post/ })).not.toBeInTheDocument()
  })

  it('unhides the post and confirms it is back in the feed', async () => {
    render(<HiddenPostCard post={post} />)

    fireEvent.click(screen.getByRole('button', { name: 'Unhide' }))

    await waitFor(() => expect(mocks.unhidePost).toHaveBeenCalledWith(post.id))
    expect(await screen.findByRole('status')).toHaveTextContent('This post is back in your feed.')
    expect(screen.getByRole('link', { name: 'View post' })).toHaveAttribute('href', `/posts/${post.id}`)
    expect(screen.queryByRole('button', { name: 'Unhide' })).not.toBeInTheDocument()
  })

  it('keeps the post listed with the server message when unhiding fails', async () => {
    mocks.unhidePost.mockResolvedValueOnce({ ok: false, error: 'We could not show this post again. Please try again.' } as never)
    render(<HiddenPostCard post={post} />)

    fireEvent.click(screen.getByRole('button', { name: 'Unhide' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not show this post again.')
    expect(await screen.findByRole('button', { name: 'Unhide' })).toBeEnabled()
  })
})

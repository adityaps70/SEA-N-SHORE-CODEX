import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComposerProfile } from '../types'
import { PostComposer } from './post-composer'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../actions', () => ({
  createPost: vi.fn(async () => ({ ok: true })),
  createPostMediaUploads: vi.fn(),
  discardPendingPostMedia: vi.fn(async () => ({ ok: true })),
}))
vi.mock('../organization-post-actions', () => ({
  loadPostingOrganizations: vi.fn(async () => ({ ok: true, organizations: [] })),
}))

const profile: ComposerProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Member A',
  avatarUrl: null,
  rank: 'Chief Officer',
  headline: 'Chief Officer',
}

const group = { id: '22222222-2222-4222-8222-222222222222', name: 'Tanker Professionals' }

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('PostComposer scoped to a community group (round 9B)', () => {
  it('sends the group id as a hidden field and names the group members as the audience', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} group={group} />)
    await user.click(screen.getByRole('button', { name: /start a post/i }))

    const dialog = screen.getByRole('dialog', { name: /create a post/i })
    const hidden = dialog.querySelector<HTMLInputElement>('input[type="hidden"][name="groupId"]')
    expect(hidden?.value).toBe(group.id)
    expect(screen.getByRole('combobox', { name: 'Audience' })).toHaveTextContent('Members of Tanker Professionals')
    expect(screen.getByText('Audience: Members of Tanker Professionals')).toBeInTheDocument()
  })

  it('keeps the open-feed audience and no group field otherwise', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.click(screen.getByRole('button', { name: /start a post/i }))

    const dialog = screen.getByRole('dialog', { name: /create a post/i })
    expect(dialog.querySelector('input[name="groupId"]')).toBeNull()
    expect(screen.getByRole('combobox', { name: 'Audience' })).toHaveTextContent('Sea N Shore community')
  })
})

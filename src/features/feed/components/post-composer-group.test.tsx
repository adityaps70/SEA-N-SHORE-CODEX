import { act, cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComposerProfile } from '../types'
import { PostComposer } from './post-composer'
import { requestComposerPrefill } from '../compose-request'

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
    const audience = screen.getByRole('combobox', { name: 'Audience (who can see this)' })
    expect(audience).toHaveTextContent('Members of Tanker Professionals')
    // Round F: a community post stays in its community; there is no audience to send.
    expect(audience).toBeDisabled()
    expect(dialog.querySelector('[name="audience"]')).toBeNull()
    // Round H (H2): the labelled select is the only place the audience shows; no "Audience: …" footer repeat.
    expect(audience).toHaveDisplayValue('Members of Tanker Professionals')
    expect(screen.queryByText(/^Audience:/)).not.toBeInTheDocument()
    expect(within(dialog).getAllByText('Audience')).toHaveLength(1)
  })

  it('keeps the open-feed audience and no group field otherwise', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.click(screen.getByRole('button', { name: /start a post/i }))

    const dialog = screen.getByRole('dialog', { name: /create a post/i })
    expect(dialog.querySelector('input[name="groupId"]')).toBeNull()
    // Round F: who can see the post; new posts start as Anyone and the author can make them members-only.
    const audience = screen.getByRole('combobox', { name: 'Audience (who can see this)' })
    expect(audience).toHaveAttribute('name', 'audience')
    expect(audience).toHaveValue('anyone')
    expect(audience).toHaveAccessibleDescription('Anyone with the link can read it, even without an account.')
    await user.selectOptions(audience, 'members')
    expect(audience).toHaveValue('members')
    expect(audience).toHaveAccessibleDescription('Only people signed in to Sea N Shore can see it.')
    // Round H (H2): the select itself shows the choice, once.
    expect(audience).toHaveDisplayValue('Members only')
    expect(screen.queryByText(/^Audience:/)).not.toBeInTheDocument()
    expect(within(dialog).getAllByText(/Members only/)).toHaveLength(1)
    expect(within(dialog).getAllByText('Audience')).toHaveLength(1)
  })
})

describe('PostComposer prefill (round H, H7: community welcome post)', () => {
  it('opens with the requested text for its own group only and keeps a draft the member already wrote', async () => {
    render(<PostComposer profile={profile} group={group} />)

    act(() => requestComposerPrefill({ groupId: 'another-group', body: 'Not for this composer' }))
    expect(screen.queryByRole('dialog', { name: /create a post/i })).not.toBeInTheDocument()

    act(() => requestComposerPrefill({ groupId: group.id, body: 'Welcome to Tanker Professionals!' }))
    const dialog = await screen.findByRole('dialog', { name: /create a post/i })
    expect(within(dialog).getByRole('textbox', { name: /post|share|what/i })).toHaveValue('Welcome to Tanker Professionals!')

    act(() => requestComposerPrefill({ groupId: group.id, body: 'A second template' }))
    expect(within(dialog).getByRole('textbox', { name: /post|share|what/i })).toHaveValue('Welcome to Tanker Professionals!')
  })
})

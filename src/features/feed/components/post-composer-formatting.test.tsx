import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComposerProfile } from '../types'
import { PostComposer } from './post-composer'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), replace: vi.fn() }) }))
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

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

async function openComposer() {
  const user = userEvent.setup()
  render(<PostComposer profile={profile} />)
  await user.click(screen.getByRole('button', { name: /start a post/i }))
  const textarea = screen.getByLabelText('Post to Sea N Shore') as HTMLTextAreaElement
  return { user, textarea, toolbar: screen.getByRole('group', { name: 'Text formatting' }) }
}

/** Lets the toolbar's own selection restore (next animation frame) land before selecting again. */
async function select(textarea: HTMLTextAreaElement, start: number, end: number) {
  await new Promise((resolve) => window.requestAnimationFrame(resolve))
  textarea.focus()
  textarea.setSelectionRange(start, end)
}

describe('PostComposer formatting toolbar (Round H)', () => {
  it('offers labelled Bold, Italic, list and Link buttons', async () => {
    const { toolbar } = await openComposer()
    expect(within(toolbar).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Bold', 'Italic', 'Bulleted list', 'Numbered list', 'Link'])
    expect(within(toolbar).getByRole('button', { name: 'Bold' })).toHaveAttribute('aria-keyshortcuts', 'Control+B Meta+B')
    for (const button of within(toolbar).getAllByRole('button')) expect(button).toHaveClass('size-9', 'max-md:size-11')
  })

  it('wraps the selection in bold and keeps it selected in the focused textarea', async () => {
    const { user, textarea, toolbar } = await openComposer()
    await user.type(textarea, 'Good Morning! all')
    await select(textarea, 0, 13)
    await user.click(within(toolbar).getByRole('button', { name: 'Bold' }))

    expect(textarea).toHaveValue('**Good Morning!** all')
    await waitFor(() => expect(textarea).toHaveFocus())
    await waitFor(() => expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([2, 15]))

    // Pressing Bold again removes the markers.
    await user.click(within(toolbar).getByRole('button', { name: 'Bold' }))
    expect(textarea).toHaveValue('Good Morning! all')
  })

  it('italicises with Ctrl+I and bolds with Cmd+B', async () => {
    const { user, textarea } = await openComposer()
    await user.type(textarea, 'calm seas')
    await select(textarea, 0, 4)
    fireEvent.keyDown(textarea, { key: 'i', ctrlKey: true })
    expect(textarea).toHaveValue('*calm* seas')

    await select(textarea, 7, 11)
    fireEvent.keyDown(textarea, { key: 'b', metaKey: true })
    expect(textarea).toHaveValue('*calm* **seas**')
  })

  it('prefixes the selected lines for bulleted and numbered lists, and adds links', async () => {
    const { user, textarea, toolbar } = await openComposer()
    await user.type(textarea, 'Muster{Enter}Report')
    await select(textarea, 0, textarea.value.length)
    await user.click(within(toolbar).getByRole('button', { name: 'Bulleted list' }))
    expect(textarea).toHaveValue('- Muster\n- Report')

    await select(textarea, 0, textarea.value.length)
    await user.click(within(toolbar).getByRole('button', { name: 'Numbered list' }))
    expect(textarea).toHaveValue('1. Muster\n2. Report')

    await select(textarea, 3, 9)
    await user.click(within(toolbar).getByRole('button', { name: 'Link' }))
    expect(textarea).toHaveValue('1. [Muster](https://)\n2. Report')
    await waitFor(() => expect(textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)).toBe('https://'))
  })

  it('shows the audience once, in the labelled select', async () => {
    await openComposer()
    const dialog = screen.getByRole('dialog', { name: /create a post/i })
    expect(within(dialog).getByRole('combobox', { name: 'Audience (who can see this)' })).toHaveDisplayValue('Anyone')
    expect(within(dialog).queryByText(/Audience:/)).not.toBeInTheDocument()
    expect(within(dialog).getAllByText('Audience')).toHaveLength(1)
  })
})

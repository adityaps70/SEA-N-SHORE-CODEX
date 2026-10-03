import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OwnProfile } from '@/features/profiles/types'
import { parseComposeRequest } from '../compose-request'
import { PostComposer } from './post-composer'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  replace: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh, replace: mocks.replace }),
}))

vi.mock('../actions', () => ({
  createPost: vi.fn(async () => ({ ok: true })),
  createPostMediaUploads: vi.fn(),
  discardPendingPostMedia: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../organization-post-actions', () => ({
  loadPostingOrganizations: vi.fn(async () => ({ ok: true, organizations: [] })),
}))

vi.mock('../pdf-page-count', () => ({ readPdfPageCount: vi.fn(async () => 1) }))
vi.mock('./upload-post-media', () => ({ uploadPostMediaFile: vi.fn() }))

const profile: OwnProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  slug: 'member-a',
  profileType: 'seafarer',
  fullName: 'Member A',
  avatarPath: null,
  location: 'Mumbai',
  headline: 'Chief Officer',
  summary: null,
  rank: 'Chief Officer',
  currentCompany: null,
  currentVessel: null,
  sailingExperienceYears: null,
  vesselTypes: [],
  tradingAreas: [],
  shoreCareerPreference: false,
  availability: null,
  skills: [],
  contactVisibility: 'members',
  onboardingCompletedAt: '2026-09-02T10:00:00.000Z',
}

function modeButton(name: 'Update' | 'Question' | 'Poll') {
  const group = screen.getByLabelText('Post type')
  return within(group).getByRole('button', { name })
}

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  window.history.replaceState({}, '', '/home')
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  Reflect.deleteProperty(navigator, 'userActivation')
})

describe('parseComposeRequest', () => {
  it('accepts only the Create sheet modes', () => {
    expect(parseComposeRequest('update')).toBe('update')
    expect(parseComposeRequest('photo')).toBe('photo')
    expect(parseComposeRequest('document')).toBe('document')
    expect(parseComposeRequest('question')).toBe('question')
    expect(parseComposeRequest('poll')).toBe('poll')
    expect(parseComposeRequest('video')).toBeUndefined()
    expect(parseComposeRequest(undefined)).toBeUndefined()
    expect(parseComposeRequest(['poll'])).toBeUndefined()
  })
})

describe('PostComposer ?compose= requests', () => {
  it('opens in Question mode and removes only the compose parameter from the address', async () => {
    window.history.replaceState({}, '', '/home?category=learning&compose=question')
    render(<PostComposer profile={profile} composeRequest="question" />)

    expect(await screen.findByRole('dialog', { name: /create a post/i })).toBeInTheDocument()
    expect(modeButton('Question')).toHaveAttribute('aria-pressed', 'true')
    expect(mocks.replace).toHaveBeenCalledTimes(1)
    expect(mocks.replace).toHaveBeenCalledWith('/home?category=learning', { scroll: false })
  })

  it('opens in Poll mode with the poll options', async () => {
    render(<PostComposer profile={profile} composeRequest="poll" />)

    expect(await screen.findByRole('dialog', { name: /create a post/i })).toBeInTheDocument()
    expect(modeButton('Poll')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByLabelText('Poll option 1')).toBeInTheDocument()
  })

  it('keeps a restored draft when asked for a plain update', async () => {
    window.localStorage.setItem(`sea-n-shore:post-draft:${profile.id}`, JSON.stringify({ body: 'Unfinished watch handover notes', mode: 'question', topicTags: '', pollOptions: [], mentions: [] }))
    render(<PostComposer profile={profile} composeRequest="update" />)

    expect(await screen.findByRole('dialog', { name: /create a post/i })).toBeInTheDocument()
    expect(screen.getByDisplayValue('Unfinished watch handover notes')).toBeInTheDocument()
    expect(modeButton('Question')).toHaveAttribute('aria-pressed', 'true')
  })

  it('opens the photo picker when the tap that navigated here still counts, and highlights the button', async () => {
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: true } })
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    render(<PostComposer profile={profile} composeRequest="photo" />)

    expect(await screen.findByRole('dialog', { name: /create a post/i })).toBeInTheDocument()
    await waitFor(() => expect(click).toHaveBeenCalledTimes(1))
    expect(click.mock.contexts[0]).toBe(screen.getByLabelText('Photo / Video'))
    expect(screen.getByText('Photo / Video').closest('label')).toHaveAttribute('data-picker-hint', 'true')
    expect(modeButton('Update')).toHaveAttribute('aria-pressed', 'true')
  })

  it('only highlights the document button when the browser would block the picker', async () => {
    Object.defineProperty(navigator, 'userActivation', { configurable: true, value: { isActive: false } })
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => {})
    render(<PostComposer profile={profile} composeRequest="document" />)

    expect(await screen.findByRole('dialog', { name: /create a post/i })).toBeInTheDocument()
    expect(click).not.toHaveBeenCalled()
    expect(screen.getByText('Document').closest('label')).toHaveAttribute('data-picker-hint', 'true')
    expect(screen.getByText('Photo / Video').closest('label')).not.toHaveAttribute('data-picker-hint')
  })

  it('stays closed without a request', () => {
    render(<PostComposer profile={profile} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(mocks.replace).not.toHaveBeenCalled()
  })
})

describe('PostComposer on phones', () => {
  it('hides the Start a post card below md on Home only', () => {
    const { rerender } = render(<PostComposer profile={profile} hideTriggerOnPhones />)
    expect(screen.getByRole('button', { name: /start a post/i }).parentElement?.parentElement).toHaveClass('max-md:hidden')

    rerender(<PostComposer profile={profile} />)
    expect(screen.getByRole('button', { name: /start a post/i }).parentElement?.parentElement).not.toHaveClass('max-md:hidden')
  })

  it('fills the screen with close and Post on top and the tools pinned at the bottom', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.click(screen.getByRole('button', { name: /start a post/i }))

    const dialog = screen.getByRole('dialog', { name: /create a post/i })
    expect(dialog).toHaveClass('max-md:h-dvh', 'max-md:rounded-none', 'max-md:flex-col')

    const bar = screen.getByTestId('composer-phone-bar')
    expect(bar).toHaveClass('md:hidden')
    expect(within(bar).getByRole('button', { name: 'Close composer' })).toBeInTheDocument()
    const post = within(bar).getByRole('button', { name: 'Post' })
    expect(post).toHaveAttribute('type', 'submit')
    expect(post).toBeDisabled()

    const toolbar = screen.getByTestId('composer-toolbar')
    expect(toolbar).toHaveClass('max-md:order-last', 'max-md:shrink-0')
    expect(within(toolbar).getByRole('button', { name: 'Add a poll' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: 'Add topic tags' })).toBeInTheDocument()
    expect(within(toolbar).getByRole('button', { name: /add emoji/i })).toBeInTheDocument()
    expect(within(toolbar).getByText('0/5000')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Post to Sea N Shore'), 'Bunkering checklist')
    expect(post).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Post Update' })).toBeEnabled()

    await user.click(within(toolbar).getByRole('button', { name: 'Add a poll' }))
    expect(modeButton('Poll')).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(toolbar).getByRole('button', { name: 'Add topic tags' }))
    expect(document.activeElement).toHaveAttribute('name', 'topicTags')
    await user.type(document.activeElement as HTMLElement, 'SIRE2, Tankers')
    expect(screen.getByTestId('composer-tag-preview')).toHaveTextContent('#SIRE2#Tankers')

    await user.click(within(bar).getByRole('button', { name: 'Close composer' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers Discard draft on phones once something is written', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.click(screen.getByRole('button', { name: /start a post/i }))
    expect(screen.getAllByRole('button', { name: 'Discard draft' })).toHaveLength(1)

    await user.type(screen.getByLabelText('Post to Sea N Shore'), 'Draft')
    const discards = screen.getAllByRole('button', { name: 'Discard draft' })
    expect(discards).toHaveLength(2)
    await user.click(discards[0]!)
    expect(screen.getByLabelText('Post to Sea N Shore')).toHaveValue('')
  })
})

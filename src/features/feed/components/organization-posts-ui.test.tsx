import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ComposerProfile, FeedPost, PostingOrganization } from '../types'
import { OrganizationPostsTab } from './organization-posts-tab'
import { PostCard } from './post-card'
import { PostComposer } from './post-composer'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  createPost: vi.fn(async (_state: unknown, formData: FormData) => { void formData; return { ok: true } }),
  updatePost: vi.fn(),
  deletePost: vi.fn(async () => ({ ok: true })),
  loadFeedPage: vi.fn(),
  loadPostingOrganizations: vi.fn(),
  loadOrganizationPostsTab: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: mocks.refresh }),
  usePathname: () => '/organizations/nordic-lng',
}))

vi.mock('../actions', () => ({
  createPost: mocks.createPost,
  createPostMediaUploads: vi.fn(),
  discardPendingPostMedia: vi.fn(async () => ({ ok: true })),
  updatePost: mocks.updatePost,
  deletePost: mocks.deletePost,
  loadFeedPage: mocks.loadFeedPage,
  loadReactionDetails: vi.fn(async () => ({ ok: true, page: { reactors: [], nextCursor: null } })),
  setPostReaction: vi.fn(async () => ({ ok: true })),
  setPostSaved: vi.fn(async () => ({ ok: true })),
  setPostHidden: vi.fn(async () => ({ ok: true })),
  addComment: vi.fn(async () => ({ ok: true })),
}))

vi.mock('../organization-post-actions', () => ({
  loadPostingOrganizations: mocks.loadPostingOrganizations,
  loadOrganizationPostsTab: mocks.loadOrganizationPostsTab,
}))

vi.mock('../mention-actions', () => ({
  searchMentionCandidates: vi.fn(async () => []),
}))

const companyId = '44444444-4444-4444-8444-444444444444'
const organization: PostingOrganization = {
  id: companyId,
  slug: 'nordic-lng',
  name: 'Nordic LNG Carriers',
  logoUrl: `/api/company-logo/${companyId}`,
}
const secondOrganization: PostingOrganization = {
  id: '99999999-9999-4999-8999-999999999999',
  slug: 'harbour-wellbeing',
  name: 'Harbour Wellbeing Trust',
  logoUrl: null,
}
const profile: ComposerProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  fullName: 'Priya Nair',
  avatarUrl: null,
  rank: null,
  headline: 'HR Manager',
}

function organizationPost(overrides: Partial<FeedPost> = {}): FeedPost {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    category: 'maritime_news',
    body: 'We are hiring second officers for our LNG fleet.',
    postType: 'standard',
    createdAt: '2026-09-20T08:00:00.000Z',
    updatedAt: '2026-09-20T08:00:00.000Z',
    author: {
      id: profile.id,
      slug: 'priya-nair',
      fullName: 'Priya Nair',
      avatarPath: null,
      headline: 'HR Manager',
      rank: null,
      currentCompany: null,
    },
    organization,
    media: null,
    poll: null,
    likeCount: 0,
    commentCount: 0,
    viewerLiked: false,
    viewerSaved: false,
    viewerOwns: false,
    viewerFollowsAuthor: true,
    comments: [],
    ...overrides,
  }
}

beforeEach(() => {
  mocks.loadPostingOrganizations.mockResolvedValue({ ok: true, organizations: [organization, secondOrganization] })
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
  window.localStorage.clear()
})

describe('PostCard for an organization post', () => {
  it('shows the organization logo, name and context instead of the person', () => {
    render(<PostCard post={organizationPost()} />)
    const article = screen.getByRole('article', { name: 'Nordic LNG Carriers' })
    expect(within(article).getByRole('link', { name: 'Nordic LNG Carriers' })).toHaveAttribute('href', '/organizations/nordic-lng')
    expect(within(article).getByRole('img', { name: 'Nordic LNG Carriers logo' })).toHaveAttribute('src', `/api/company-logo/${companyId}`)
    expect(within(article).getByText('Organization')).toBeInTheDocument()
    expect(within(article).queryByRole('link', { name: 'Priya Nair' })).not.toBeInTheDocument()
  })

  it('offers Hide and Report, but not Unfollow of the person, to other members', () => {
    render(<PostCard post={organizationPost()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    const menu = screen.getByRole('menu')
    const labels = within(menu).getAllByRole('menuitem').map((item) => item.textContent?.trim())
    expect(labels).toEqual(['Save post', 'Copy link', 'Hide post', 'Report post'])
  })

  it('lets an organization admin edit the post and shows who wrote it', async () => {
    mocks.updatePost.mockResolvedValueOnce({ ok: true, post: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', body: 'We are hiring second and third officers.', mentions: [] } })
    const user = userEvent.setup()
    render(<PostCard post={organizationPost({ viewerCanEdit: true, viewerCanDelete: true })} />)
    expect(screen.getByText('Organization · Posted by Priya Nair')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Post options' }))
    const labels = within(screen.getByRole('menu')).getAllByRole('menuitem').map((item) => item.textContent?.trim())
    expect(labels).toEqual(['Save post', 'Copy link', 'Edit post', 'Delete post'])
    await user.click(screen.getByRole('menuitem', { name: 'Edit post' }))

    const dialog = screen.getByRole('dialog', { name: 'Edit post' })
    expect(dialog).toHaveTextContent('Posting as Nordic LNG Carriers')
    const textbox = within(dialog).getByRole('textbox', { name: 'Post text' })
    const save = within(dialog).getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()
    await user.clear(textbox)
    await user.type(textbox, 'We are hiring second and third officers.')
    await user.click(save)

    await waitFor(() => expect(mocks.updatePost).toHaveBeenCalledWith({
      postId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      body: 'We are hiring second and third officers.',
      mentionProfileIds: [],
    }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Edit post' })).not.toBeInTheDocument())
    expect(screen.getByText('We are hiring second and third officers.')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Your changes are saved.')
  })

  it('keeps the edit open with the server message when saving fails', async () => {
    mocks.updatePost.mockResolvedValueOnce({ ok: false, error: 'You can no longer edit this post. Only its author and the organization admins can change it.' })
    const user = userEvent.setup()
    render(<PostCard post={organizationPost({ viewerOwns: true, viewerCanEdit: true, viewerCanDelete: true })} />)
    await user.click(screen.getByRole('button', { name: 'Post options' }))
    await user.click(screen.getByRole('menuitem', { name: 'Edit post' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit post' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Post text' }), ' Apply now.')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(/can no longer edit this post/i)
    expect(within(dialog).getByRole('textbox', { name: 'Post text' })).toHaveValue('We are hiring second officers for our LNG fleet. Apply now.')
  })

  it('warns an admin that deleting removes the post for everyone', async () => {
    render(<PostCard post={organizationPost({ viewerCanDelete: true })} />)
    fireEvent.click(screen.getByRole('button', { name: 'Post options' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete post' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete this post?' })
    expect(dialog).toHaveTextContent(/from Nordic LNG Carriers's page for everyone, including Priya Nair/i)
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete post' }))
    await waitFor(() => expect(mocks.deletePost).toHaveBeenCalledWith('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'))
    expect(await screen.findByText(/no longer appears in the feed or on the organization page/i)).toBeInTheDocument()
  })
})

describe('PostComposer "Post as"', () => {
  it('lets the member choose an organization and submits its id', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.click(screen.getByRole('button', { name: 'Start a post' }))
    const dialog = screen.getByRole('dialog', { name: 'Create a post' })

    const chooser = await within(dialog).findByRole('button', { name: /Post as yourself, Priya Nair/i })
    await user.click(chooser)
    const menu = within(dialog).getByRole('menu', { name: 'Post as' })
    expect(within(menu).getByRole('menuitemradio', { name: /Priya Nair/ })).toHaveAttribute('aria-checked', 'true')
    expect(within(menu).getByRole('img', { name: 'Nordic LNG Carriers logo' })).toBeInTheDocument()
    await user.click(within(menu).getByRole('menuitemradio', { name: /Harbour Wellbeing Trust/ }))

    expect(within(dialog).queryByRole('menu', { name: 'Post as' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: /Post as Harbour Wellbeing Trust/i })).toHaveFocus()
    expect(dialog).toHaveTextContent(/Shown as Harbour Wellbeing Trust in the feed/)

    await user.type(within(dialog).getByRole('textbox', { name: 'Post to Sea N Shore' }), 'Free counselling line for crews this week.')
    await user.click(within(dialog).getByRole('button', { name: 'Post Update' }))
    await waitFor(() => expect(mocks.createPost).toHaveBeenCalled())
    const formData = mocks.createPost.mock.calls[0]?.[1] as FormData
    expect(formData.get('companyId')).toBe(secondOrganization.id)
  })

  it('closes only the Post as menu on Escape', async () => {
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.click(screen.getByRole('button', { name: 'Start a post' }))
    await user.click(await screen.findByRole('button', { name: /Post as yourself/i }))
    expect(screen.getByRole('menu', { name: 'Post as' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('menu', { name: 'Post as' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Create a post' })).toBeInTheDocument()
  })

  it('shows no chooser for members who cannot post for any organization', async () => {
    mocks.loadPostingOrganizations.mockResolvedValueOnce({ ok: true, organizations: [] })
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.click(screen.getByRole('button', { name: 'Start a post' }))
    await waitFor(() => expect(mocks.loadPostingOrganizations).toHaveBeenCalledTimes(1))
    expect(screen.queryByRole('button', { name: /Post as/i })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Create a post' })).toHaveTextContent('Priya Nair')
  })

  it('tells the member when their organizations could not be loaded', async () => {
    mocks.loadPostingOrganizations.mockResolvedValueOnce({ ok: false, error: 'x' })
    const user = userEvent.setup()
    render(<PostComposer profile={profile} />)
    await user.click(screen.getByRole('button', { name: 'Start a post' }))
    expect(await screen.findByText(/could not load the organizations you post for/i)).toBeInTheDocument()
  })

  it('starts preset to an organization on its page, without loading the list again', () => {
    render(<PostComposer profile={profile} postingOrganizations={[organization]} defaultOrganizationId={companyId} />)
    expect(screen.getByRole('button', { name: 'Start a post as Nordic LNG Carriers' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Nordic LNG Carriers logo' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start a post as Nordic LNG Carriers' }))
    const dialog = screen.getByRole('dialog', { name: 'Create a post' })
    expect(within(dialog).getByRole('button', { name: /^Post as Nordic LNG Carriers/i })).toBeInTheDocument()
    expect(mocks.loadPostingOrganizations).not.toHaveBeenCalled()
  })
})

describe('OrganizationPostsTab', () => {
  const nextCursor = { createdAt: '2026-09-19T08:00:00.000Z', id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }

  it('lists the organization posts with the composer preset, and loads more on request', async () => {
    mocks.loadOrganizationPostsTab.mockResolvedValueOnce({
      ok: true,
      page: { posts: [organizationPost()], nextCursor },
      composer: { profile, organization, organizations: [organization] },
    })
    mocks.loadFeedPage.mockResolvedValueOnce({
      ok: true,
      page: { posts: [organizationPost({ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', body: 'Our new LNG carrier joined the fleet.' })], nextCursor: null },
    })
    render(<OrganizationPostsTab companyId={companyId} companySlug="nordic-lng" canPost limit={1} />)

    expect(screen.getByRole('status', { name: 'Loading posts' })).toBeInTheDocument()
    expect(await screen.findByText('We are hiring second officers for our LNG fleet.')).toBeInTheDocument()
    expect(mocks.loadOrganizationPostsTab).toHaveBeenCalledWith({ companyId, limit: 1, includeComposer: true })
    expect(screen.getByRole('button', { name: 'Start a post as Nordic LNG Carriers' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Show more posts' }))
    expect(await screen.findByText('Our new LNG carrier joined the fleet.')).toBeInTheDocument()
    expect(mocks.loadFeedPage).toHaveBeenCalledWith({ companyId, cursor: nextCursor, limit: 1 })
    expect(screen.queryByRole('button', { name: 'Show more posts' })).not.toBeInTheDocument()
  })

  it('shows an empty state without a composer for followers', async () => {
    mocks.loadOrganizationPostsTab.mockResolvedValueOnce({ ok: true, page: { posts: [], nextCursor: null }, composer: null })
    render(<OrganizationPostsTab companyId={companyId} companySlug="nordic-lng" canPost={false} />)
    expect(await screen.findByText('No posts from this organization yet')).toBeInTheDocument()
    expect(mocks.loadOrganizationPostsTab).toHaveBeenCalledWith({ companyId, limit: 10, includeComposer: false })
    expect(screen.queryByRole('button', { name: /Start a post/ })).not.toBeInTheDocument()
  })

  it('invites posting in the empty state when the viewer can post', async () => {
    mocks.loadOrganizationPostsTab.mockResolvedValueOnce({ ok: true, page: { posts: [], nextCursor: null }, composer: { profile, organization, organizations: [organization] } })
    render(<OrganizationPostsTab companyId={companyId} companySlug="nordic-lng" canPost />)
    expect(await screen.findByText('No posts from Nordic LNG Carriers yet')).toBeInTheDocument()
  })

  it('explains a load failure and retries', async () => {
    mocks.loadOrganizationPostsTab
      .mockResolvedValueOnce({ ok: false, error: 'We could not load this organization’s posts.' })
      .mockResolvedValueOnce({ ok: true, page: { posts: [organizationPost()], nextCursor: null }, composer: null })
    render(<OrganizationPostsTab companyId={companyId} companySlug="nordic-lng" canPost={false} />)
    const alert = await screen.findByRole('alert')
    expect(alert).toHaveTextContent('We could not load this organization’s posts. Check your connection and try again.')
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText('We are hiring second officers for our LNG fleet.')).toBeInTheDocument()
  })

  it('reloads the first page after publishing from the preset composer', async () => {
    mocks.loadOrganizationPostsTab
      .mockResolvedValueOnce({ ok: true, page: { posts: [], nextCursor: null }, composer: { profile, organization, organizations: [organization] } })
      .mockResolvedValueOnce({ ok: true, page: { posts: [organizationPost({ body: 'Welcome aboard, new cadets!' })], nextCursor: null }, composer: { profile, organization, organizations: [organization] } })
    const user = userEvent.setup()
    render(<OrganizationPostsTab companyId={companyId} companySlug="nordic-lng" canPost />)
    await user.click(await screen.findByRole('button', { name: 'Start a post as Nordic LNG Carriers' }))
    const dialog = screen.getByRole('dialog', { name: 'Create a post' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Post to Sea N Shore' }), 'Welcome aboard, new cadets!')
    await user.click(within(dialog).getByRole('button', { name: 'Post Update' }))
    await waitFor(() => expect(mocks.createPost).toHaveBeenCalled())
    expect((mocks.createPost.mock.calls[0]?.[1] as FormData).get('companyId')).toBe(companyId)
    expect(await screen.findByText('Welcome aboard, new cadets!')).toBeInTheDocument()
    expect(mocks.loadOrganizationPostsTab).toHaveBeenCalledTimes(2)
  })
})

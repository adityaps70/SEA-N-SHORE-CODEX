import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createStandardPostWithAurora: vi.fn(async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  createPollPostWithAurora: vi.fn(async () => 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
  updatePostWithAurora: vi.fn(async () => ({ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', postType: 'standard' })),
  restoreDeletedPostWithAurora: vi.fn(async () => true),
  getPostById: vi.fn(),
  getFeedPage: vi.fn(),
  getPostingOrganizations: vi.fn(),
  getOwnProfile: vi.fn(),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/moderation/repository', () => ({
  moderationRepository: { flagContentAutomatically: vi.fn(async () => undefined) },
}))
vi.mock('@/features/auth/aws-queries', () => ({
  requireAwsUser: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111', cognitoSub: 'sub', email: null })),
}))
vi.mock('./media', () => ({
  createPendingPostMediaUpload: vi.fn(),
  verifyPendingPostMedia: vi.fn(async () => undefined),
  removeFeedImage: vi.fn(async () => undefined),
}))
vi.mock('./queries', () => ({
  getFeedPage: mocks.getFeedPage,
  getPostById: mocks.getPostById,
  getPostingOrganizations: mocks.getPostingOrganizations,
}))
vi.mock('@/features/profiles/queries', () => ({ getOwnProfile: mocks.getOwnProfile }))
vi.mock('./service', () => ({
  createStandardPostWithAurora: mocks.createStandardPostWithAurora,
  createPollPostWithAurora: mocks.createPollPostWithAurora,
  updatePostWithAurora: mocks.updatePostWithAurora,
  restoreDeletedPostWithAurora: mocks.restoreDeletedPostWithAurora,
}))

const viewerId = '11111111-1111-4111-8111-111111111111'
const companyId = '44444444-4444-4444-8444-444444444444'
const postId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const organization = { id: companyId, slug: 'nordic-lng', name: 'Nordic LNG Carriers', logoUrl: null }

function postForm(fields: Record<string, string | string[]>) {
  const formData = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) formData.append(key, entry)
  }
  return formData
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('createPost as an organization', () => {
  it('passes the chosen organization to the service, and nothing when posting as yourself', async () => {
    const { createPost } = await import('./actions')
    await expect(createPost({}, postForm({ mode: 'standard', category: 'maritime_news', body: 'Hiring second officers.', companyId }))).resolves.toEqual({ ok: true })
    expect(mocks.createStandardPostWithAurora).toHaveBeenCalledWith(viewerId, {
      category: 'maritime_news',
      body: 'Hiring second officers.',
      mentionProfileIds: [],
      organizationMentionIds: [],
      companyId,
    })

    await createPost({}, postForm({ mode: 'standard', category: 'maritime_news', body: 'Personal update.', companyId: '' }))
    expect(mocks.createStandardPostWithAurora).toHaveBeenLastCalledWith(viewerId, {
      category: 'maritime_news',
      body: 'Personal update.',
      mentionProfileIds: [],
      organizationMentionIds: [],
    })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/organizations/[slug]', 'page')
  })

  it('explains what to do when the member can no longer post for the organization', async () => {
    mocks.createPollPostWithAurora.mockRejectedValueOnce(new Error('feed_organization_post_forbidden'))
    const { createPost } = await import('./actions')
    const result = await createPost({}, postForm({ mode: 'poll', category: 'maritime_news', body: 'Which route?', pollOption: ['North', 'South'], companyId }))
    expect(result.error).toMatch(/no longer post for this organization/i)
    expect(result.error).toMatch(/Yourself/)
    expect(result.values?.body).toBe('Which route?')
  })

  it('rejects a malformed organization id before touching the database', async () => {
    const { createPost } = await import('./actions')
    const result = await createPost({}, postForm({ mode: 'standard', category: 'maritime_news', body: 'Hi', companyId: 'not-a-uuid' }))
    expect(result.fieldErrors?.companyId?.[0]).toMatch(/choose who this post is from/i)
    expect(mocks.createStandardPostWithAurora).not.toHaveBeenCalled()
  })
})

describe('updatePost', () => {
  it('saves the new text and returns the refreshed body and mentions', async () => {
    mocks.getPostById.mockResolvedValueOnce({ id: postId, body: 'Updated text', mentions: [] })
    const { updatePost } = await import('./actions')
    await expect(updatePost({ postId, body: '  Updated text  ' })).resolves.toEqual({
      ok: true,
      post: { id: postId, body: 'Updated text', mentions: [] },
    })
    expect(mocks.updatePostWithAurora).toHaveBeenCalledWith(viewerId, postId, { body: 'Updated text', mentionProfileIds: [], organizationMentionIds: [] })
  })

  it('turns service refusals into plain messages', async () => {
    const { updatePost } = await import('./actions')
    mocks.updatePostWithAurora.mockRejectedValueOnce(new Error('feed_post_edit_forbidden'))
    await expect(updatePost({ postId, body: 'x' })).resolves.toEqual({ ok: false, error: expect.stringMatching(/can no longer edit this post/i) })
    mocks.updatePostWithAurora.mockRejectedValueOnce(new Error('feed_post_body_required'))
    await expect(updatePost({ postId, body: '' })).resolves.toEqual({ ok: false, error: 'Write something before saving.' })
    mocks.updatePostWithAurora.mockRejectedValueOnce(new Error('boom'))
    await expect(updatePost({ postId, body: 'x' })).resolves.toEqual({ ok: false, error: expect.stringMatching(/edits are still here/i) })
    await expect(updatePost({ postId: 'bad', body: 'x' })).resolves.toMatchObject({ ok: false })
  })

  it('explains why an organization post cannot be restored', async () => {
    mocks.restoreDeletedPostWithAurora.mockRejectedValueOnce(new Error('feed_post_restore_organization_forbidden'))
    const { restoreDeletedPost } = await import('./actions')
    await expect(restoreDeletedPost(postId)).resolves.toEqual({ ok: false, error: expect.stringMatching(/no longer post for/i) })
  })
})

describe('organization posts tab loader', () => {
  const page = { posts: [], nextCursor: null }
  const profile = { id: viewerId, fullName: 'Priya Nair', avatarUrl: null, rank: null, headline: 'HR Manager' }

  it('returns the composer only when the server confirms the viewer can post as that organization', async () => {
    mocks.getFeedPage.mockResolvedValue(page)
    mocks.getOwnProfile.mockResolvedValue(profile)
    mocks.getPostingOrganizations.mockResolvedValueOnce([organization])
    const { loadOrganizationPostsTab } = await import('./organization-post-actions')

    await expect(loadOrganizationPostsTab({ companyId })).resolves.toEqual({
      ok: true,
      page,
      composer: { profile, organization, organizations: [organization] },
    })
    expect(mocks.getFeedPage).toHaveBeenCalledWith({ companyId, limit: 10 })

    mocks.getPostingOrganizations.mockResolvedValueOnce([])
    await expect(loadOrganizationPostsTab({ companyId, limit: 5 })).resolves.toMatchObject({ ok: true, composer: null })
  })

  it('skips the composer lookups when the page says the viewer cannot post', async () => {
    mocks.getFeedPage.mockResolvedValue(page)
    const { loadOrganizationPostsTab } = await import('./organization-post-actions')
    await expect(loadOrganizationPostsTab({ companyId, includeComposer: false })).resolves.toMatchObject({ ok: true, composer: null })
    expect(mocks.getPostingOrganizations).not.toHaveBeenCalled()
    expect(mocks.getOwnProfile).not.toHaveBeenCalled()
  })

  it('reports invalid ids and load failures with a readable message', async () => {
    const { loadOrganizationPostsTab, loadPostingOrganizations } = await import('./organization-post-actions')
    await expect(loadOrganizationPostsTab({ companyId: 'nope' })).resolves.toEqual({ ok: false, error: 'This organization could not be found.' })
    mocks.getFeedPage.mockRejectedValueOnce(new Error('db down'))
    await expect(loadOrganizationPostsTab({ companyId })).resolves.toEqual({ ok: false, error: expect.stringMatching(/could not load/i) })
    mocks.getPostingOrganizations.mockRejectedValueOnce(new Error('db down'))
    await expect(loadPostingOrganizations()).resolves.toEqual({ ok: false, error: expect.stringMatching(/still post as yourself/i) })
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const viewerId = '11111111-1111-4111-8111-111111111111'
const postId = '33333333-3333-4333-8333-333333333333'
const recipientId = '44444444-4444-4444-8444-444444444444'
const conversationId = '55555555-5555-4555-8555-555555555555'
const repostId = '66666666-6666-4666-8666-666666666666'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(async () => ({ id: '11111111-1111-4111-8111-111111111111' })),
  getPostById: vi.fn(),
  getNetworkHub: vi.fn(),
  startDirectConversationAction: vi.fn(),
  sendMessageAction: vi.fn(),
  headers: vi.fn(async () => new Headers({ host: 'seanshore.example', 'x-forwarded-proto': 'https' })),
  repostPostWithAurora: vi.fn(async () => '66666666-6666-4666-8666-666666666666'),
  setPostHiddenWithAurora: vi.fn(async () => true),
  flagContentAutomatically: vi.fn(async () => undefined),
  revalidatePath: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('next/headers', () => ({ headers: mocks.headers }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/messaging/actions', () => ({
  startDirectConversationAction: mocks.startDirectConversationAction,
  sendMessageAction: mocks.sendMessageAction,
}))
vi.mock('@/features/network/queries', () => ({ getNetworkHub: mocks.getNetworkHub }))
vi.mock('@/features/moderation/repository', () => ({
  moderationRepository: { flagContentAutomatically: mocks.flagContentAutomatically },
}))
vi.mock('./queries', () => ({ getPostById: mocks.getPostById, getFeedPage: vi.fn() }))
vi.mock('./media', () => ({
  resolveFeedMediaUrls: vi.fn(async () => new Map()),
  createPendingPostMediaUpload: vi.fn(),
  verifyPendingPostMedia: vi.fn(),
  removeFeedImage: vi.fn(),
}))
vi.mock('./service', () => ({
  repostPostWithAurora: mocks.repostPostWithAurora,
  setPostHiddenWithAurora: mocks.setPostHiddenWithAurora,
}))

const originalSiteUrl = process.env.NEXT_PUBLIC_SITE_URL

function setSiteUrl(value: string | undefined) {
  if (value === undefined) delete process.env.NEXT_PUBLIC_SITE_URL
  else process.env.NEXT_PUBLIC_SITE_URL = value
}

afterEach(() => setSiteUrl(originalSiteUrl))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getPostById.mockResolvedValue({ id: postId, author: { fullName: 'Captain Rao' } })
  mocks.startDirectConversationAction.mockResolvedValue({ ok: true, conversationId })
  mocks.sendMessageAction.mockResolvedValue({ ok: true, message: {} })
  mocks.getNetworkHub.mockResolvedValue({
    totalCount: 2,
    profiles: [
      { id: recipientId, slug: 'officer-lee', fullName: 'Officer Lee', avatarUrl: 'https://signed/avatar', rank: 'Second Officer', currentCompany: 'Blue Fleet', headline: null },
      { id: '77777777-7777-4777-8777-777777777777', slug: 'cadet', fullName: 'Cadet Ali', avatarUrl: null, rank: null, currentCompany: null, headline: null },
    ],
  })
})

describe('sendPostToConnection', () => {
  it('opens (or reuses) the direct conversation and sends the note with an absolute post link', async () => {
    setSiteUrl('https://d3prih0q6jofyr.cloudfront.net/')
    const { sendPostToConnection } = await import('./share-actions')
    await expect(sendPostToConnection({ postId, recipientProfileId: recipientId, note: '  Read point 3.  ' }))
      .resolves.toEqual({ ok: true, conversationId })

    expect(mocks.getPostById).toHaveBeenCalledWith(postId)
    expect(mocks.startDirectConversationAction).toHaveBeenCalledWith(recipientId)
    const [message] = mocks.sendMessageAction.mock.calls[0] as unknown as [{ conversationId: string; clientMessageId: string; body: string }]
    expect(message.conversationId).toBe(conversationId)
    expect(message.clientMessageId).toMatch(/^[0-9a-f-]{36}$/)
    expect(message.body).toBe(`Read point 3.\n\nCaptain Rao's post on Sea N Shore:\nhttps://d3prih0q6jofyr.cloudfront.net/posts/${postId}`)
  })

  it('falls back to the request host when no site URL is configured', async () => {
    setSiteUrl(undefined)
    const { sendPostToConnection } = await import('./share-actions')
    await sendPostToConnection({ postId, recipientProfileId: recipientId })
    const [message] = mocks.sendMessageAction.mock.calls[0] as unknown as [{ body: string }]
    expect(message.body).toBe(`Captain Rao's post on Sea N Shore:\nhttps://seanshore.example/posts/${postId}`)
  })

  it('validates input before any lookups and refuses sending to yourself', async () => {
    const { sendPostToConnection } = await import('./share-actions')
    await expect(sendPostToConnection({ postId, recipientProfileId: 'nope' })).resolves.toEqual({ ok: false, error: 'Choose a connection to send this post to.' })
    await expect(sendPostToConnection({ postId, recipientProfileId: recipientId, note: 'x'.repeat(1001) }))
      .resolves.toEqual({ ok: false, error: 'Keep your note to 1,000 characters or fewer.' })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()

    await expect(sendPostToConnection({ postId, recipientProfileId: viewerId }))
      .resolves.toMatchObject({ ok: false, error: expect.stringMatching(/cannot send a post to yourself/i) })
    expect(mocks.startDirectConversationAction).not.toHaveBeenCalled()
  })

  it('refuses posts the sender can no longer see', async () => {
    mocks.getPostById.mockResolvedValueOnce(null)
    const { sendPostToConnection } = await import('./share-actions')
    await expect(sendPostToConnection({ postId, recipientProfileId: recipientId }))
      .resolves.toEqual({ ok: false, error: 'This post is no longer available to share.' })
    expect(mocks.startDirectConversationAction).not.toHaveBeenCalled()
  })

  it('passes on the messaging rule when the recipient is not a connection', async () => {
    mocks.startDirectConversationAction.mockResolvedValueOnce({ ok: false, error: 'You can message accepted connections only.' })
    const { sendPostToConnection } = await import('./share-actions')
    await expect(sendPostToConnection({ postId, recipientProfileId: recipientId }))
      .resolves.toEqual({ ok: false, error: 'You can message accepted connections only.' })
    expect(mocks.sendMessageAction).not.toHaveBeenCalled()
  })

  it('reports a failed message send', async () => {
    mocks.sendMessageAction.mockResolvedValueOnce({ ok: false, error: 'We could not update this conversation. Please try again.' })
    const { sendPostToConnection } = await import('./share-actions')
    await expect(sendPostToConnection({ postId, recipientProfileId: recipientId }))
      .resolves.toEqual({ ok: false, error: 'We could not update this conversation. Please try again.' })
  })
})

describe('searchShareRecipients', () => {
  it('returns matching accepted connections with a readable detail line', async () => {
    const { searchShareRecipients } = await import('./share-actions')
    const result = await searchShareRecipients(' lee ')
    expect(mocks.getNetworkHub).toHaveBeenCalledWith('connections', 'lee')
    expect(result).toEqual({
      ok: true,
      totalConnections: 2,
      recipients: [
        { id: recipientId, slug: 'officer-lee', fullName: 'Officer Lee', avatarUrl: 'https://signed/avatar', detail: 'Second Officer · Blue Fleet' },
        { id: '77777777-7777-4777-8777-777777777777', slug: 'cadet', fullName: 'Cadet Ali', avatarUrl: null, detail: 'Maritime professional' },
      ],
    })
  })

  it('explains a load failure', async () => {
    mocks.getNetworkHub.mockRejectedValueOnce(new Error('db down'))
    const { searchShareRecipients } = await import('./share-actions')
    await expect(searchShareRecipients('')).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/could not load your connections/i) })
  })
})

describe('repostPost with commentary', () => {
  it('keeps plain reposts unchanged', async () => {
    const { repostPost } = await import('./actions')
    await expect(repostPost(postId)).resolves.toEqual({ ok: true, postId: repostId })
    expect(mocks.repostPostWithAurora).toHaveBeenCalledWith(viewerId, postId)
  })

  it('stores trimmed commentary with mentions', async () => {
    const { repostPost } = await import('./actions')
    await repostPost(postId, { body: '  Good lesson for cadets.  ', mentionProfileIds: [recipientId] })
    expect(mocks.repostPostWithAurora).toHaveBeenCalledWith(viewerId, postId, { body: 'Good lesson for cadets.', mentionProfileIds: [recipientId] })
  })

  it('blocks unsafe commentary before saving and rejects overly long commentary', async () => {
    const { repostPost } = await import('./actions')
    await expect(repostPost(postId, { body: 'I will attack you when you reach the terminal.' }))
      .resolves.toMatchObject({ ok: false, error: expect.stringMatching(/community safety rules/i) })
    await expect(repostPost(postId, { body: 'x'.repeat(3001) }))
      .resolves.toEqual({ ok: false, error: 'Keep your thoughts to 3,000 characters or fewer.' })
    expect(mocks.repostPostWithAurora).not.toHaveBeenCalled()
  })

  it('explains a duplicate repost', async () => {
    mocks.repostPostWithAurora.mockRejectedValueOnce(new Error('feed_repost_duplicate'))
    const { repostPost } = await import('./actions')
    await expect(repostPost(postId, { body: 'Again' })).resolves.toEqual({ ok: false, error: 'You already reposted this post.' })
  })
})

describe('setPostHidden', () => {
  it('hides and un-hides for the signed-in member without revalidating the feed', async () => {
    const { setPostHidden } = await import('./actions')
    await expect(setPostHidden(postId, true)).resolves.toEqual({ ok: true })
    await expect(setPostHidden(postId, false)).resolves.toEqual({ ok: true })
    expect(mocks.setPostHiddenWithAurora).toHaveBeenNthCalledWith(1, viewerId, postId, true)
    expect(mocks.setPostHiddenWithAurora).toHaveBeenNthCalledWith(2, viewerId, postId, false)
    expect(mocks.revalidatePath).not.toHaveBeenCalled()
  })

  it('validates before authenticating and explains failures in plain words', async () => {
    const { setPostHidden } = await import('./actions')
    await expect(setPostHidden('bad', true)).resolves.toEqual({ ok: false, error: 'Invalid post.' })
    expect(mocks.requireAwsUser).not.toHaveBeenCalled()

    mocks.setPostHiddenWithAurora.mockRejectedValueOnce(new Error('feed_hide_own_post'))
    await expect(setPostHidden(postId, true)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/cannot hide your own post/i) })
    mocks.setPostHiddenWithAurora.mockRejectedValueOnce(new Error('feed_interaction_unavailable'))
    await expect(setPostHidden(postId, true)).resolves.toEqual({ ok: false, error: 'We could not hide this post. Please try again.' })
  })
})

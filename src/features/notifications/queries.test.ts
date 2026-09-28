import { describe, expect, it, vi } from 'vitest'

const USER_ID = '11111111-1111-4111-8111-111111111111'
const ACTOR_ID = '22222222-2222-4222-8222-222222222222'
const POST_ID = '55555555-5555-4555-8555-555555555555'
const COMMENT_ID = '66666666-6666-4666-8666-666666666666'

function notification(overrides: Record<string, unknown> = {}) {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    actor_id: ACTOR_ID as string | null,
    notification_type: 'connection_request' as 'connection_request' | 'event_cancelled',
    post_id: null,
    comment_id: null,
    reaction_type: null,
    created_at: '2026-09-05T10:00:00.000Z',
    read_at: null,
    ...overrides,
  }
}

function queriesFor(rows: ReturnType<typeof notification>[]) {
  return import('./queries').then(({ createNotificationQueries }) => createNotificationQueries({
    requireUser: vi.fn(async () => ({ id: USER_ID })),
    repository: {
      listRecent: vi.fn(async () => rows),
      countUnread: vi.fn(async () => rows.filter((row) => !row.read_at).length),
    } as never,
    getProfiles: vi.fn(async () => [{ id: ACTOR_ID, slug: 'captain-rhea', fullName: 'Captain Rhea' }]) as never,
  }))
}

describe('AWS notification queries', () => {
  it('loads recipient-scoped rows and hydrates actors using the permanent profile UUID', async () => {
    const repository = {
      listRecent: vi.fn(async () => [notification()]),
      countUnread: vi.fn(async () => 1),
    }
    const getProfiles = vi.fn(async () => [{
      id: ACTOR_ID,
      slug: 'captain-rhea',
      fullName: 'Captain Rhea',
    }])
    const { createNotificationQueries } = await import('./queries')
    const queries = createNotificationQueries({
      requireUser: vi.fn(async () => ({ id: USER_ID })),
      repository: repository as never,
      getProfiles: getProfiles as never,
    })

    await expect(queries.getNotifications(100)).resolves.toEqual([
      expect.objectContaining({
        type: 'connection_request',
        message: 'Captain Rhea sent you a connection request.',
        destination: '/network?tab=requests',
        actor: { id: ACTOR_ID, slug: 'captain-rhea', fullName: 'Captain Rhea', avatarUrl: null },
      }),
    ])

    expect(repository.listRecent).toHaveBeenCalledWith(USER_ID, 100)
    expect(getProfiles).toHaveBeenCalledWith([ACTOR_ID])
  })

  it('preserves accepted/follower profile destinations and anonymous actor fallback copy', async () => {
    const repository = {
      listRecent: vi.fn(async () => [
        notification({ notification_type: 'connection_accepted' }),
        notification({ id: '44444444-4444-4444-8444-444444444444', notification_type: 'new_follower', actor_id: null }),
      ]),
      countUnread: vi.fn(async () => 0),
    }
    const { createNotificationQueries } = await import('./queries')
    const queries = createNotificationQueries({
      requireUser: vi.fn(async () => ({ id: USER_ID })),
      repository: repository as never,
      getProfiles: vi.fn(async () => [{ id: ACTOR_ID, slug: 'captain-rhea', fullName: 'Captain Rhea' }]) as never,
    })

    const rows = await queries.getNotifications(8)
    expect(rows[0]).toMatchObject({
      message: 'Captain Rhea accepted your connection request.',
      destination: '/people/captain-rhea',
    })
    expect(rows[1]).toMatchObject({
      message: 'A maritime professional started following you.',
      destination: '/network',
      actor: null,
    })
  })

  it.each([
    ['post_comment', null, 'commented on your post', true, `/posts/${POST_ID}#comment-${COMMENT_ID}`],
    ['comment_reply', null, 'replied to your comment', true, `/posts/${POST_ID}#comment-${COMMENT_ID}`],
    ['post_reaction', 'respect', 'reacted Respect 🫡 to your post', false, `/posts/${POST_ID}`],
    ['comment_reaction', 'support', 'reacted Support ❤️ to your comment', true, `/posts/${POST_ID}#comment-${COMMENT_ID}`],
    ['post_mention', null, 'mentioned you in a post', false, `/posts/${POST_ID}`],
    ['comment_mention', null, 'mentioned you in a comment', true, `/posts/${POST_ID}#comment-${COMMENT_ID}`],
  ])('maps %s social notifications to professional copy and a deep link', async (notificationType, reactionType, copy, hasCommentTarget, destination) => {
    const commentId = hasCommentTarget ? COMMENT_ID : null
    const queries = await queriesFor([notification({
      notification_type: notificationType,
      post_id: POST_ID,
      comment_id: commentId,
      reaction_type: reactionType,
    })])
    const [row] = await queries.getNotifications(8)
    expect(row).toMatchObject({
      type: notificationType,
      message: `Captain Rhea ${copy}.`,
      destination,
      postId: POST_ID,
      commentId,
      reactionType,
    })
  })

  it('builds notification chrome from one recipient-scoped load and unread count', async () => {
    const repository = {
      listRecent: vi.fn(async () => []),
      countUnread: vi.fn(async () => 4),
    }
    const { createNotificationQueries } = await import('./queries')
    const queries = createNotificationQueries({
      requireUser: vi.fn(async () => ({ id: USER_ID })),
      repository: repository as never,
      getProfiles: vi.fn(async () => []) as never,
    })

    await expect(queries.getNotificationChrome()).resolves.toEqual({ recent: [], unreadCount: 4 })
    expect(repository.listRecent).toHaveBeenCalledWith(USER_ID, 8)
    expect(repository.countUnread).toHaveBeenCalledWith(USER_ID)
  })

  it('adds the actor photo and one batched post preview per page, signing only photo and video media', async () => {
    const OTHER_POST_ID = '77777777-7777-4777-8777-777777777777'
    const DOC_POST_ID = '88888888-8888-4888-8888-888888888888'
    const repository = {
      listRecent: vi.fn(async () => [
        notification({ notification_type: 'post_reaction', post_id: POST_ID, reaction_type: 'like' }),
        notification({ id: '44444444-4444-4444-8444-444444444444', notification_type: 'post_comment', post_id: POST_ID, comment_id: COMMENT_ID }),
        notification({ id: '45454545-4545-4545-8545-454545454545', notification_type: 'post_mention', post_id: OTHER_POST_ID }),
        notification({ id: '46464646-4646-4646-8646-464646464646', notification_type: 'post_mention', post_id: DOC_POST_ID }),
        notification({ id: '47474747-4747-4747-8747-474747474747', notification_type: 'new_follower' }),
      ]),
      countUnread: vi.fn(async () => 0),
      listPostPreviews: vi.fn(async () => [
        { post_id: POST_ID, snippet: 'Sharing photos from   our\nlifeboat drill in Singapore anchorage this morning with the whole crew', media_path: 'author/post/one.jpg', media_mime_type: 'image/jpeg' },
        { post_id: OTHER_POST_ID, snippet: 'Short text only', media_path: null, media_mime_type: null },
        { post_id: DOC_POST_ID, snippet: 'Checklist attached', media_path: 'author/doc/list.pdf', media_mime_type: 'application/pdf' },
      ]),
    }
    const getProfiles = vi.fn(async () => [{ id: ACTOR_ID, slug: 'captain-rhea', fullName: 'Captain Rhea', avatarUrl: 'https://signed.example/rhea.webp' }])
    const resolveMediaUrls = vi.fn(async (paths: string[]) => new Map(paths.map((path) => [path, `/api/feed-media/${path}`])))
    const { createNotificationQueries } = await import('./queries')
    const queries = createNotificationQueries({
      requireUser: vi.fn(async () => ({ id: USER_ID })),
      repository: repository as never,
      getProfiles: getProfiles as never,
      resolveMediaUrls,
    })

    const rows = await queries.getNotifications(20)

    expect(repository.listPostPreviews).toHaveBeenCalledTimes(1)
    expect(repository.listPostPreviews).toHaveBeenCalledWith(USER_ID, [POST_ID, OTHER_POST_ID, DOC_POST_ID])
    expect(getProfiles).toHaveBeenCalledTimes(1)
    expect(resolveMediaUrls).toHaveBeenCalledTimes(1)
    expect(resolveMediaUrls).toHaveBeenCalledWith(['author/post/one.jpg'])
    expect(rows[0]?.actor?.avatarUrl).toBe('https://signed.example/rhea.webp')
    expect(rows[0]?.postPreview).toEqual({
      postId: POST_ID,
      mediaUrl: '/api/feed-media/author/post/one.jpg',
      mediaType: 'image',
      text: 'Sharing photos from our lifeboat drill in Singapore…',
    })
    expect(rows[1]?.postPreview?.postId).toBe(POST_ID)
    expect(rows[2]?.postPreview).toEqual({ postId: OTHER_POST_ID, mediaUrl: null, mediaType: null, text: 'Short text only' })
    expect(rows[3]?.postPreview).toEqual({ postId: DOC_POST_ID, mediaUrl: null, mediaType: null, text: 'Checklist attached' })
    expect(rows[4]?.postPreview).toBeNull()
  })

  it('still lists notifications when the post preview lookup fails', async () => {
    const repository = {
      listRecent: vi.fn(async () => [notification({ notification_type: 'post_reaction', post_id: POST_ID, reaction_type: 'like' })]),
      countUnread: vi.fn(async () => 1),
      listPostPreviews: vi.fn(async () => { throw new Error('boom') }),
    }
    const { createNotificationQueries } = await import('./queries')
    const queries = createNotificationQueries({
      requireUser: vi.fn(async () => ({ id: USER_ID })),
      repository: repository as never,
      getProfiles: vi.fn(async () => []) as never,
      resolveMediaUrls: vi.fn(async () => new Map()),
    })

    const chrome = await queries.getNotificationChrome()
    expect(chrome.recent).toHaveLength(1)
    expect(chrome.recent[0]?.postPreview).toBeNull()
  })

  it('explains a cancelled event without naming the deleted organiser and links to My events', async () => {
    const queries = await queriesFor([notification({ actor_id: null, notification_type: 'event_cancelled' })])
    await expect(queries.getNotifications(10)).resolves.toEqual([
      expect.objectContaining({
        type: 'event_cancelled',
        actor: null,
        message: 'An event you registered for was cancelled because its organiser left Sea N Shore. Paid tickets are refunded in full.',
        destination: '/events/my',
      }),
    ])
  })
})

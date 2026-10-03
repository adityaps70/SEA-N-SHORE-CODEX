import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { mapFeedPost, type FeedPostRow } from './mappers'
import type { FeedRepository } from './repository'
import type { FeedSocialWriter } from './social-writer'

const viewerId = '11111111-1111-4111-8111-111111111111'
const authorId = '22222222-2222-4222-8222-222222222222'
const postId = '33333333-3333-4333-8333-333333333333'
const rootId = '44444444-4444-4444-8444-444444444444'
const replyId = '55555555-5555-4555-8555-555555555555'
const replierId = '66666666-6666-4666-8666-666666666666'
const newCommentId = '77777777-7777-4777-8777-777777777777'
const mentionId = '88888888-8888-4888-8888-888888888888'

type QueryCall = [text: string, values?: readonly unknown[]]

function callsOf(query: { mock: { calls: unknown[] } }): QueryCall[] {
  return query.mock.calls as unknown as QueryCall[]
}

async function repositoryWith(rows: unknown[] = []) {
  const query = vi.fn(async () => rows)
  const { createFeedRepository } = await import('./repository')
  return { query, repository: createFeedRepository({ query: query as never }) }
}

function serviceRepository(overrides: Partial<Record<keyof FeedRepository, unknown>> = {}) {
  return {
    isMemberReady: vi.fn(async () => true),
    getInteractablePost: vi.fn(async () => ({ id: postId, authorId, postType: 'standard' as const })),
    getCommentForInteraction: vi.fn(async () => null),
    addComment: vi.fn(async () => newCommentId),
    insertCommentMentions: vi.fn(async () => []),
    insertPostMentions: vi.fn(async () => [mentionId]),
    insertRepost: vi.fn(async () => undefined),
    setHidden: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as FeedRepository & Record<string, ReturnType<typeof vi.fn>>
}

function socialWriter() {
  return {
    upsertNotification: vi.fn(async () => undefined),
    deleteNotification: vi.fn(async () => undefined),
    enqueue: vi.fn(async () => undefined),
  } as unknown as FeedSocialWriter & Record<string, ReturnType<typeof vi.fn>>
}

async function serviceFor(repo: FeedRepository, social?: FeedSocialWriter) {
  const { createFeedService } = await import('./service')
  return createFeedService({
    createId: () => postId,
    withTransaction: async <T>(fn: (repository: FeedRepository, social?: FeedSocialWriter) => Promise<T>) => fn(repo, social),
  })
}

describe('migration 0039: feed sharing, reply targets and hidden posts', () => {
  const sql = readFileSync(resolve(process.cwd(), 'infra/aws/database/migrations/0039_feed_sharing_threads_hides.sql'), 'utf8')
  const normalized = sql.toLowerCase().replace(/\s+/g, ' ')

  it('is additive and safe to run twice', () => {
    expect(sql).not.toMatch(/\btruncate\b|\bdelete\s+from\b|\bdrop\s+table\b|\bdrop\s+column\b|\bupdate\s+public\./i)
    expect(normalized).toContain('drop constraint if exists posts_body_check')
    expect(normalized).toContain('add column if not exists reply_to_comment_id uuid references public.post_comments(id) on delete set null')
    expect(normalized).toContain('create table if not exists public.post_hides')
    expect(normalized).toContain('create index if not exists post_comments_reply_to_idx')
    expect(normalized).toContain('create index if not exists post_hides_post_idx')
    const statements = sql.split('-- statement-breakpoint').map((part) => part.trim()).filter(Boolean)
    expect(statements).toHaveLength(5)
  })

  it('lets reposts carry trimmed commentary while plain reposts keep an empty body', () => {
    expect(normalized).toMatch(/post_type = 'repost' and body = btrim\(body\) and char_length\(body\) <= 5000/)
    expect(normalized).toMatch(/post_type <> 'repost' and body = btrim\(body\) and char_length\(body\) between 1 and 5000/)
  })

  it('keys hidden posts per member and post, cascading with either', () => {
    expect(normalized).toMatch(/user_id uuid not null references public\.profiles\(id\) on delete cascade/)
    expect(normalized).toMatch(/post_id uuid not null references public\.posts\(id\) on delete cascade/)
    expect(normalized).toContain('primary key (user_id, post_id)')
  })
})

describe('feed repository: hides, follows, reply targets and commentary', () => {
  it('keeps hidden posts, and reposts of a hidden original, out of the viewer feed without new parameters', async () => {
    const { query, repository } = await repositoryWith()
    await repository.listFeedRows({ viewerProfileId: viewerId, limit: 13 })
    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/not exists \(\s*select 1 from public\.post_hides hidden\s*where hidden\.user_id = \$1/i)
    expect(sql).toMatch(/hidden\.post_id = p\.id or hidden\.post_id = p\.repost_of_post_id/i)
    expect(values).toEqual([viewerId, 13])
  })

  it('does not apply the hide filter to saved posts or the single-post page', async () => {
    const { query, repository } = await repositoryWith()
    await repository.listSavedRows({ viewerProfileId: viewerId, limit: 5 })
    await repository.getPostRow(viewerId, postId)
    for (const [sql] of callsOf(query)) expect(sql).not.toMatch(/post_hides/i)
  })

  it('reports whether the viewer follows each post author', async () => {
    const { query, repository } = await repositoryWith()
    await repository.getPostRow(viewerId, postId)
    const [sql] = callsOf(query)[0]
    expect(sql).toMatch(/from public\.follows viewer_follow\s*where viewer_follow\.follower_id = \$1 and viewer_follow\.following_id = p\.author_id/i)
    expect(sql).toMatch(/as viewer_follows_author/i)
  })

  it('stores and clears a hide idempotently for the viewer only', async () => {
    const { query, repository } = await repositoryWith()
    await repository.setHidden(viewerId, postId, true)
    await repository.setHidden(viewerId, postId, false)
    const [insert, remove] = callsOf(query)
    expect(insert[0]).toMatch(/insert into public\.post_hides \(user_id, post_id\) values \(\$1, \$2\) on conflict \(user_id, post_id\) do nothing/i)
    expect(insert[1]).toEqual([viewerId, postId])
    expect(remove[0]).toMatch(/delete from public\.post_hides where user_id = \$1 and post_id = \$2/i)
    expect(remove[1]).toEqual([viewerId, postId])
  })

  it('records the reply target only when one is given', async () => {
    const { query, repository } = await repositoryWith([{ id: newCommentId }])
    await repository.addComment(viewerId, postId, 'Direct answer.', rootId, replyId)
    await repository.addComment(viewerId, postId, 'Top level.', null)
    const [withTarget, plain] = callsOf(query)
    expect(withTarget[0]).toMatch(/insert into public\.post_comments \(post_id, author_id, body, parent_comment_id, reply_to_comment_id\)/i)
    expect(withTarget[1]).toEqual([postId, viewerId, 'Direct answer.', rootId, replyId])
    expect(plain[0]).not.toMatch(/reply_to_comment_id/i)
    expect(plain[1]).toEqual([postId, viewerId, 'Top level.', null])
  })

  it('hydrates the reply target author for comments', async () => {
    const { query, repository } = await repositoryWith()
    await repository.getComments([postId], viewerId)
    const [sql] = callsOf(query)[0]
    expect(sql).toMatch(/left join public\.post_comments reply_target on reply_target\.id = c\.reply_to_comment_id/i)
    expect(sql).toMatch(/'author_name', reply_target_author\.full_name/i)
    expect(sql).toMatch(/as reply_to/i)
  })

  it('inserts repost commentary as a bound parameter', async () => {
    const { query, repository } = await repositoryWith([{ id: newCommentId }])
    await repository.insertRepost({ id: newCommentId, authorId: viewerId, sourcePostId: postId, body: '  Worth reading.  ' })
    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/select \$1, \$2, source\.category, \$4, 'repost', source\.id/i)
    expect(values).toEqual([newCommentId, viewerId, postId, 'Worth reading.'])
  })
})

describe('feed mapper', () => {
  const baseRow: FeedPostRow = {
    id: postId,
    category: 'learning',
    body: 'Body',
    post_type: 'standard',
    created_at: '2026-09-10T09:00:00.000Z',
    updated_at: '2026-09-10T09:00:00.000Z',
    profiles: { id: authorId, slug: 'author', full_name: 'Author Name', avatar_path: null, headline: null, maritime_profiles: null },
    post_media: null,
    post_polls: null,
    viewer_follows_author: true,
    post_comments: [{
      id: replyId,
      post_id: postId,
      parent_comment_id: rootId,
      reply_to: { comment_id: rootId, author_name: 'Root Author', author_slug: 'root-author' },
      body: 'Reply',
      created_at: '2026-09-10T09:01:00.000Z',
      profiles: { id: replierId, slug: 'replier', full_name: 'Replier', avatar_path: null, headline: null, maritime_profiles: null },
    }],
  }
  const viewer = { savedPostIds: new Set<string>(), pollVotes: new Map<string, string>() }

  it('maps the reply target and follow state for the signed-in viewer', () => {
    const post = mapFeedPost(baseRow, viewer, new Map(), viewerId)
    expect(post.viewerFollowsAuthor).toBe(true)
    expect(post.comments[0]?.replyTo).toEqual({ commentId: rootId, authorName: 'Root Author', authorSlug: 'root-author' })
  })

  it('never reports following on public views or the viewer’s own post', () => {
    expect(mapFeedPost(baseRow, viewer).viewerFollowsAuthor).toBe(false)
    expect(mapFeedPost(baseRow, viewer, new Map(), authorId).viewerFollowsAuthor).toBe(false)
  })
})

describe('feed service', () => {
  it('keeps a reply to a reply in the root thread, records its target and notifies both people', async () => {
    const getCommentForInteraction = vi.fn(async (_actor: string, id: string) => id === replyId
      ? { id: replyId, postId, authorId: replierId, parentCommentId: rootId, rootParentId: rootId, postAuthorId: authorId }
      : { id: rootId, postId, authorId, parentCommentId: null, rootParentId: rootId, postAuthorId: authorId })
    const repo = serviceRepository({ getCommentForInteraction })
    const social = socialWriter()
    const service = await serviceFor(repo, social)

    await expect(service.addComment(viewerId, postId, ' Answer ', replyId)).resolves.toBe(newCommentId)
    expect(repo.addComment).toHaveBeenCalledWith(viewerId, postId, 'Answer', rootId, replyId)
    const recipients = vi.mocked(social.upsertNotification).mock.calls.map((call) => (call[0] as { recipientId: string }).recipientId)
    expect(recipients).toEqual([authorId, replierId])
    expect(social.upsertNotification).toHaveBeenCalledWith(expect.objectContaining({ recipientId: replierId, type: 'comment_reply', dedupeKey: `comment-reply:${newCommentId}` }))
  })

  it('does not record a target or double-notify for a direct reply to the top-level comment', async () => {
    const repo = serviceRepository({
      getCommentForInteraction: vi.fn(async () => ({ id: rootId, postId, authorId, parentCommentId: null, rootParentId: rootId, postAuthorId: authorId })),
    })
    const social = socialWriter()
    const service = await serviceFor(repo, social)
    await service.addComment(viewerId, postId, 'Answer', rootId)
    expect(repo.addComment).toHaveBeenCalledWith(viewerId, postId, 'Answer', rootId)
    expect(social.upsertNotification).toHaveBeenCalledTimes(1)
  })

  it('does not notify the replier about their own reply target', async () => {
    const repo = serviceRepository({
      getCommentForInteraction: vi.fn(async (_actor: string, id: string) => id === replyId
        ? { id: replyId, postId, authorId: viewerId, parentCommentId: rootId, rootParentId: rootId, postAuthorId: authorId }
        : { id: rootId, postId, authorId, parentCommentId: null, rootParentId: rootId, postAuthorId: authorId }),
    })
    const social = socialWriter()
    const service = await serviceFor(repo, social)
    await service.addComment(viewerId, postId, 'Follow-up to myself', replyId)
    expect(social.upsertNotification).toHaveBeenCalledTimes(1)
    expect(social.upsertNotification).toHaveBeenCalledWith(expect.objectContaining({ recipientId: authorId }))
  })

  it('stores repost commentary and notifies mentioned members', async () => {
    const repo = serviceRepository()
    const social = socialWriter()
    const service = await serviceFor(repo, social)
    await service.repostPost(viewerId, postId, { body: '  Read this @Member  ', mentionProfileIds: [mentionId] })
    expect(repo.insertRepost).toHaveBeenCalledWith({ id: postId, authorId: viewerId, sourcePostId: postId, body: 'Read this @Member' })
    expect(repo.insertPostMentions).toHaveBeenCalledWith(viewerId, postId, [mentionId])
    expect(social.upsertNotification).toHaveBeenCalledWith(expect.objectContaining({ recipientId: mentionId, type: 'post_mention' }))
  })

  it('hides only posts the viewer can see and never their own', async () => {
    const repo = serviceRepository()
    const service = await serviceFor(repo)
    await expect(service.setHidden(viewerId, postId, true)).resolves.toBe(true)
    expect(repo.getInteractablePost).toHaveBeenCalledWith({ viewerProfileId: viewerId, postId })
    expect(repo.setHidden).toHaveBeenCalledWith(viewerId, postId, true)

    const ownRepo = serviceRepository({ getInteractablePost: vi.fn(async () => ({ id: postId, authorId: viewerId, postType: 'standard' })) })
    await expect((await serviceFor(ownRepo)).setHidden(viewerId, postId, true)).rejects.toThrow('feed_hide_own_post')
    expect(ownRepo.setHidden).not.toHaveBeenCalled()

    const goneRepo = serviceRepository({ getInteractablePost: vi.fn(async () => null) })
    await expect((await serviceFor(goneRepo)).setHidden(viewerId, postId, true)).rejects.toThrow('feed_interaction_unavailable')
  })

  it('lets a member un-hide a post even if it is no longer interactable', async () => {
    const repo = serviceRepository({ getInteractablePost: vi.fn(async () => null) })
    const service = await serviceFor(repo)
    await expect(service.setHidden(viewerId, postId, false)).resolves.toBe(true)
    expect(repo.setHidden).toHaveBeenCalledWith(viewerId, postId, false)
  })
})

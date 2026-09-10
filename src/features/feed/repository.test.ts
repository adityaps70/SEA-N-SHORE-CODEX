import { describe, expect, it, vi } from 'vitest'
import type { FeedPostRow } from './mappers'

const viewerId = '11111111-1111-4111-8111-111111111111'
const authorId = '22222222-2222-4222-8222-222222222222'
const postId = '33333333-3333-4333-8333-333333333333'
const commentId = '44444444-4444-4444-8444-444444444444'

type QueryCall = [text: string, values?: readonly unknown[]]

function callsOf(query: { mock: { calls: unknown[] } }): QueryCall[] {
  return query.mock.calls as unknown as QueryCall[]
}

describe('feed repository', () => {
  it('loads feed rows in created_at/id descending order with cursor, category and bilateral block exclusion', async () => {
    const query = vi.fn(async () => [] as FeedPostRow[])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await repository.listFeedRows({
      viewerProfileId: viewerId,
      category: 'safety_lessons',
      cursor: { createdAt: '2026-09-05T06:00:00.000Z', id: postId },
      limit: 21,
    })

    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/p\.deleted_at is null/i)
    expect(sql).toMatch(/p\.category = \$2/i)
    expect(sql).toMatch(/\(p\.created_at < \$3 or \(p\.created_at = \$3 and p\.id < \$4\)\)/i)
    expect(sql).toMatch(/user_blocks/i)
    expect(sql).toMatch(/order by p\.created_at desc, p\.id desc/i)
    expect(sql).toMatch(/limit \$5/i)
    expect(sql).not.toMatch(/\band\s+and\b/i)
    expect(values).toEqual([viewerId, 'safety_lessons', '2026-09-05T06:00:00.000Z', postId, 21])
  })

  it('loads only the signed-in member saved posts in most-recently-saved order', async () => {
    const query = vi.fn(async () => [] as FeedPostRow[])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await (repository as unknown as {
      listSavedRows: (lookup: { viewerProfileId: string; limit: number }) => Promise<FeedPostRow[]>
    }).listSavedRows({ viewerProfileId: viewerId, limit: 50 })

    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/join public\.saved_posts/i)
    expect(sql).toMatch(/saved\.user_id = \$1/i)
    expect(sql).toMatch(/p\.deleted_at is null/i)
    expect(sql).toMatch(/user_blocks/i)
    expect(sql).toMatch(/order by saved\.created_at desc, p\.id desc/i)
    expect(sql).toMatch(/limit \$2/i)
    expect(values).toEqual([viewerId, 50])
  })

  it('hydrates viewer reaction, saved and vote state only for the permanent viewer UUID', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([{ post_id: postId, reaction_type: 'support' }])
      .mockResolvedValueOnce([{ post_id: postId }])
      .mockResolvedValueOnce([{ post_id: postId, option_id: '44444444-4444-4444-8444-444444444444' }])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    const state = await repository.getViewerState(viewerId, [postId])

    expect(state.postReactions?.get(postId)).toBe('support')
    expect(state.savedPostIds.has(postId)).toBe(true)
    expect(state.pollVotes.get(postId)).toBe('44444444-4444-4444-8444-444444444444')
    for (const [, values] of callsOf(query)) expect(values?.[0]).toBe(viewerId)
  })

  it('hydrates comment ownership and edit eligibility from database time', async () => {
    const query = vi.fn(async () => [])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await repository.getComments([postId], viewerId)

    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/c\.updated_at/i)
    expect(sql).toMatch(/c\.deleted_at/i)
    expect(sql).toMatch(/c\.author_id\s*=\s*\$2[^\n]*as viewer_owns/i)
    expect(sql).toMatch(/now\(\)\s*<\s*c\.created_at\s*\+\s*interval\s+'15 minutes'/i)
    expect(sql).toMatch(/as can_edit/i)
    expect(values).toEqual([[postId], viewerId])
  })

  it('lazily lists visible post reactors with an optional reaction filter without changing feed hydration', async () => {
    const query = vi.fn(async () => [])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query }) as unknown as {
      listReactionDetails(input: {
        viewerProfileId: string
        targetType: 'post' | 'comment'
        targetId: string
        reaction?: 'like' | 'support' | 'respect' | 'on_point'
        limit: number
      }): Promise<{ rows: unknown[]; nextCursor: string | null }>
    }

    await repository.listReactionDetails({
      viewerProfileId: viewerId,
      targetType: 'post',
      targetId: postId,
      reaction: 'support',
      limit: 30,
    })

    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/from public\.post_reactions reaction/i)
    expect(sql).toMatch(/join public\.profiles reactor on reactor\.id = reaction\.user_id/i)
    expect(sql).toMatch(/left join public\.maritime_profiles/i)
    expect(sql).toMatch(/reaction\.post_id = \$2/i)
    expect(sql).toMatch(/reaction\.reaction_type = \$3/i)
    expect(sql).toMatch(/reactor\.account_status = 'active'/i)
    expect(sql).toMatch(/reactor\.onboarding_completed_at is not null/i)
    expect(sql).toMatch(/user_blocks/i)
    expect(sql).toMatch(/order by reaction\.created_at desc, reaction\.user_id desc/i)
    expect(sql).toMatch(/limit \$4/i)
    expect(values).toEqual([viewerId, postId, 'support', 31])
  })

  it('lazily paginates comment reactors with a stable opaque cursor', async () => {
    const first = {
      profile_id: '55555555-5555-4555-8555-555555555555',
      slug: 'reactor-a',
      full_name: 'Reactor A',
      avatar_path: null,
      headline: null,
      rank: 'Chief Officer',
      current_company: 'Example Shipping',
      reaction_type: 'respect',
      reacted_at: '2026-09-10T09:00:00.000Z',
    }
    const second = {
      ...first,
      profile_id: '66666666-6666-4666-8666-666666666666',
      slug: 'reactor-b',
      full_name: 'Reactor B',
      reacted_at: '2026-09-10T08:59:00.000Z',
    }
    const query = vi.fn(async () => [first, second])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query }) as unknown as {
      listReactionDetails(input: {
        viewerProfileId: string
        targetType: 'post' | 'comment'
        targetId: string
        limit: number
      }): Promise<{ rows: typeof first[]; nextCursor: string | null }>
    }

    const result = await repository.listReactionDetails({
      viewerProfileId: viewerId,
      targetType: 'comment',
      targetId: commentId,
      limit: 1,
    })

    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/from public\.comment_reactions reaction/i)
    expect(sql).toMatch(/reaction\.comment_id = \$2/i)
    expect(sql).toMatch(/order by reaction\.created_at desc, reaction\.user_id desc/i)
    expect(values).toEqual([viewerId, commentId, 2])
    expect(result.rows).toEqual([first])
    expect(result.nextCursor).toBe(`${first.reacted_at}|${first.profile_id}`)
  })

  it('checks post interaction availability with active viewer and bilateral block exclusion', async () => {
    const query = vi.fn(async () => [{ id: postId, author_id: authorId, post_type: 'standard' }])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await expect(repository.getInteractablePost({ viewerProfileId: viewerId, postId })).resolves.toEqual({
      id: postId,
      authorId,
      postType: 'standard',
    })
    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/account_status = 'active'/i)
    expect(sql).toMatch(/onboarding_completed_at is not null/i)
    expect(sql).toMatch(/user_blocks/i)
    expect(values).toEqual([postId, viewerId])
  })

  it('uses viewer-scoped idempotent like/save/vote persistence', async () => {
    const query = vi.fn(async () => [])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await repository.setLiked(viewerId, postId, true)
    await repository.setSaved(viewerId, postId, false)
    await repository.setPollVote(viewerId, postId, '44444444-4444-4444-8444-444444444444')

    const calls = callsOf(query)
    expect(calls[0][0]).toMatch(/on conflict \(post_id, user_id\) do nothing/i)
    expect(calls[0][1]).toEqual([postId, viewerId])
    expect(calls[1][0]).toMatch(/delete from public\.saved_posts/i)
    expect(calls[1][1]).toEqual([postId, viewerId])
    expect(calls[2][0]).toMatch(/on conflict \(post_id, user_id\).*do update/i)
    expect(calls[2][1]).toEqual([postId, '44444444-4444-4444-8444-444444444444', viewerId])
  })

  it('checks whether an exact storage path is already attached before pending media can be deleted', async () => {
    const storagePath = `${viewerId}/${postId}/55555555-5555-4555-8555-555555555555.mp4`
    const query = vi.fn(async () => [{ attached: true }])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await expect(repository.isPostMediaAttached(storagePath)).resolves.toBe(true)

    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/select\s+exists\s*\(/i)
    expect(sql).toMatch(/from public\.post_media/i)
    expect(sql).toMatch(/storage_path = \$1/i)
    expect(values).toEqual([storagePath])
  })

  it('updates an owned non-deleted comment only before the strict database 15-minute cutoff', async () => {
    const query = vi.fn(async () => [{ id: commentId, post_id: postId, parent_comment_id: null }])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query }) as unknown as {
      updateOwnCommentWithinEditWindow(ownerId: string, id: string, body: string): Promise<{ id: string; postId: string; parentCommentId: string | null } | null>
    }

    await expect(repository.updateOwnCommentWithinEditWindow(viewerId, commentId, 'Updated watchkeeping note.')).resolves.toEqual({
      id: commentId,
      postId,
      parentCommentId: null,
    })

    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/update public\.post_comments/i)
    expect(sql).toMatch(/set body = \$3/i)
    expect(sql).toMatch(/id = \$2/i)
    expect(sql).toMatch(/author_id = \$1/i)
    expect(sql).toMatch(/deleted_at is null/i)
    expect(sql).toMatch(/now\(\)\s*<\s*created_at\s*\+\s*interval\s+'15 minutes'/i)
    expect(sql).not.toMatch(/now\(\)\s*<=/i)
    expect(sql).toMatch(/returning id, post_id, parent_comment_id/i)
    expect(values).toEqual([viewerId, commentId, 'Updated watchkeeping note.'])
  })

  it('soft-deletes an owned comment at any age without an edit-window condition', async () => {
    const query = vi.fn(async () => [{ id: commentId, post_id: postId, parent_comment_id: null }])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query }) as unknown as {
      softDeleteOwnComment(ownerId: string, id: string): Promise<{ id: string; postId: string; parentCommentId: string | null } | null>
    }

    await expect(repository.softDeleteOwnComment(viewerId, commentId)).resolves.toEqual({
      id: commentId,
      postId,
      parentCommentId: null,
    })

    const [sql, values] = callsOf(query)[0]
    expect(sql).toMatch(/update public\.post_comments/i)
    expect(sql).toMatch(/set deleted_at = now\(\)/i)
    expect(sql).toMatch(/id = \$2/i)
    expect(sql).toMatch(/author_id = \$1/i)
    expect(sql).toMatch(/deleted_at is null/i)
    expect(sql).not.toMatch(/15 minutes/i)
    expect(sql).toMatch(/returning id, post_id, parent_comment_id/i)
    expect(values).toEqual([viewerId, commentId])
  })

  it('replaces comment mentions and reports only newly introduced allowed mentionees', async () => {
    const existingMentionId = '55555555-5555-4555-8555-555555555555'
    const newMentionId = '66666666-6666-4666-8666-666666666666'
    const query = vi.fn(async (sql: string, values?: readonly unknown[]) => {
      if (/select mentioned_profile_id as id from public\.content_mentions/i.test(sql)) return [{ id: existingMentionId }]
      if (/delete from public\.content_mentions/i.test(sql)) return []
      if (/select exists/i.test(sql)) return [{ allowed: true }]
      if (/insert into public\.content_mentions/i.test(sql)) return [{ id: values?.[2] }]
      return []
    })
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query }) as unknown as {
      replaceCommentMentions(actorId: string, id: string, mentionIds: string[]): Promise<{ mentionProfileIds: string[]; newlyIntroducedProfileIds: string[] }>
    }

    await expect(repository.replaceCommentMentions(viewerId, commentId, [existingMentionId, newMentionId, newMentionId])).resolves.toEqual({
      mentionProfileIds: [existingMentionId, newMentionId],
      newlyIntroducedProfileIds: [newMentionId],
    })

    const calls = callsOf(query)
    expect(calls[0][0]).toMatch(/select mentioned_profile_id as id from public\.content_mentions/i)
    expect(calls[0][1]).toEqual([commentId])
    expect(calls[1][0]).toMatch(/delete from public\.content_mentions where comment_id = \$1/i)
    expect(calls[1][1]).toEqual([commentId])
    expect(calls.filter(([sql]) => /insert into public\.content_mentions/i.test(sql))).toHaveLength(2)
  })

  it('hydrates deleted roots only as sanitized tombstones when visible replies remain', async () => {
    const query = vi.fn(async () => [])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await repository.getComments([postId], viewerId)

    const [sql] = callsOf(query)[0]
    expect(sql).toMatch(/case when c\.deleted_at is null then c\.body else '' end as body/i)
    expect(sql).toMatch(/c\.deleted_at is null\s+or\s+\(c\.parent_comment_id is null\s+and\s+exists/i)
    expect(sql).toMatch(/reply\.parent_comment_id = c\.id/i)
    expect(sql).toMatch(/reply\.deleted_at is null/i)
    expect(sql).toMatch(/case when c\.deleted_at is null then json_build_object/i)
    expect(sql).toMatch(/case when c\.deleted_at is null then coalesce/i)
  })

  it('keeps deleted roots with visible replies in top-level pagination and counts', async () => {
    const query = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ count: '1' }])
    const { createFeedRepository } = await import('./repository')
    const repository = createFeedRepository({ query })

    await repository.listTopLevelComments(postId, viewerId, 0, 10)
    await repository.countTopLevelComments(postId)

    const calls = callsOf(query)
    expect(calls[0][0]).toMatch(/c\.deleted_at is null\s+or\s+exists/i)
    expect(calls[0][0]).toMatch(/reply\.parent_comment_id = c\.id/i)
    expect(calls[0][0]).toMatch(/reply\.deleted_at is null/i)
    expect(calls[1][0]).toMatch(/deleted_at is null\s+or\s+exists/i)
    expect(calls[1][0]).toMatch(/reply\.parent_comment_id = public\.post_comments\.id|reply\.parent_comment_id = c\.id/i)
    expect(calls[1][0]).toMatch(/reply\.deleted_at is null/i)
  })
})
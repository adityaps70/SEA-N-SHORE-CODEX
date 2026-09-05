import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import type { FeedCommentRow, FeedPostRow, FeedViewerState } from './mappers'
import type { FeedCursor, PostCategory } from './types'

type FeedQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type FeedRow = QueryResultRow & FeedPostRow
type CommentRow = QueryResultRow & FeedCommentRow
type PostInteractionRow = QueryResultRow & { id: string; author_id: string; post_type: 'standard' | 'poll' }
type PostStateRow = QueryResultRow & { post_id: string; option_id?: string }

export type FeedRowsLookup = {
  viewerProfileId: string
  category?: PostCategory
  cursor?: FeedCursor
  limit: number
}

export type FeedMediaInput = {
  storagePath: string
  mimeType: string
  altText: string | null
}

const FEED_ROW_SELECT = `
  select
    p.id,
    p.category::text as category,
    p.body,
    p.post_type::text as post_type,
    p.created_at,
    p.updated_at,
    json_build_object(
      'id', author.id,
      'slug', author.slug,
      'full_name', author.full_name,
      'avatar_path', author.avatar_path,
      'headline', author.headline,
      'maritime_profiles', case
        when maritime.user_id is null then null
        else json_build_object('rank', maritime.rank, 'current_company', maritime.current_company)
      end
    ) as profiles,
    (
      select json_build_object(
        'storage_path', media.storage_path,
        'mime_type', media.mime_type,
        'alt_text', media.alt_text
      )
      from public.post_media media
      where media.post_id = p.id
      limit 1
    ) as post_media,
    case when p.post_type = 'poll' then json_build_object(
      'post_poll_options', coalesce((
        select json_agg(
          json_build_object(
            'id', option_row.id,
            'label', option_row.label,
            'position', option_row.position,
            'post_poll_votes', json_build_object(
              'count', (select count(*)::int from public.post_poll_votes vote where vote.option_id = option_row.id)
            )
          ) order by option_row.position asc
        )
        from public.post_poll_options option_row
        where option_row.post_id = p.id
      ), '[]'::json)
    ) else null end as post_polls,
    json_build_object('count', (select count(*)::int from public.post_reactions reaction where reaction.post_id = p.id)) as post_reactions,
    json_build_object('count', (select count(*)::int from public.post_comments comment_count where comment_count.post_id = p.id and comment_count.deleted_at is null)) as post_comment_count
  from public.posts p
  join public.profiles author on author.id = p.author_id
  left join public.maritime_profiles maritime on maritime.user_id = author.id
` as const

function visibilitySql() {
  return `
    exists (
      select 1 from public.profiles viewer
      where viewer.id = $1
        and viewer.account_status = 'active'
        and viewer.onboarding_completed_at is not null
    )
    and (
      p.author_id = $1
      or (
        author.account_status = 'active'
        and author.onboarding_completed_at is not null
        and not exists (
          select 1 from public.user_blocks b
          where (b.blocker_id = $1 and b.blocked_id = p.author_id)
             or (b.blocker_id = p.author_id and b.blocked_id = $1)
        )
      )
    )
  `
}

export function createFeedRepository(input: { query?: FeedQuery } = {}) {
  const queryRows: FeedQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  async function listFeedRows(lookup: FeedRowsLookup): Promise<FeedPostRow[]> {
    const values: unknown[] = [lookup.viewerProfileId]
    const clauses = [`p.deleted_at is null`, visibilitySql()]

    if (lookup.category) {
      values.push(lookup.category)
      clauses.push(`p.category = $${values.length}`)
    }
    if (lookup.cursor) {
      values.push(lookup.cursor.createdAt)
      const createdAtParameter = values.length
      values.push(lookup.cursor.id)
      const idParameter = values.length
      clauses.push(`(p.created_at < $${createdAtParameter} or (p.created_at = $${createdAtParameter} and p.id < $${idParameter}))`)
    }
    values.push(lookup.limit)
    const limitParameter = values.length

    const rows = await queryRows(
      `${FEED_ROW_SELECT}
       where ${clauses.join('\n         and ')}
       order by p.created_at desc, p.id desc
       limit $${limitParameter}`,
      values,
    ) as FeedRow[]
    return rows as FeedPostRow[]
  }

  async function getPostRow(viewerProfileId: string, postId: string): Promise<FeedPostRow | null> {
    const rows = await queryRows(
      `${FEED_ROW_SELECT}
       where p.id = $2
         and p.deleted_at is null
         and ${visibilitySql()}
       limit 1`,
      [viewerProfileId, postId],
    ) as FeedRow[]
    return rows[0] ?? null
  }

  async function getViewerState(viewerProfileId: string, postIds: string[]): Promise<FeedViewerState> {
    if (!postIds.length) return { likedPostIds: new Set(), savedPostIds: new Set(), pollVotes: new Map() }

    const liked = await queryRows(
      `select post_id from public.post_reactions where user_id = $1 and post_id = any($2::uuid[])`,
      [viewerProfileId, postIds],
    ) as PostStateRow[]
    const saved = await queryRows(
      `select post_id from public.saved_posts where user_id = $1 and post_id = any($2::uuid[])`,
      [viewerProfileId, postIds],
    ) as PostStateRow[]
    const votes = await queryRows(
      `select post_id, option_id from public.post_poll_votes where user_id = $1 and post_id = any($2::uuid[])`,
      [viewerProfileId, postIds],
    ) as PostStateRow[]
    return {
      likedPostIds: new Set(liked.map((row) => row.post_id)),
      savedPostIds: new Set(saved.map((row) => row.post_id)),
      pollVotes: new Map(votes.flatMap((row) => row.option_id ? [[row.post_id, row.option_id] as const] : [])),
    }
  }

  async function getComments(postIds: string[]): Promise<FeedCommentRow[]> {
    if (!postIds.length) return []
    return await queryRows(
      `select
         c.id, c.post_id, c.body, c.created_at,
         json_build_object(
           'id', author.id,
           'slug', author.slug,
           'full_name', author.full_name,
           'avatar_path', author.avatar_path,
           'headline', author.headline,
           'maritime_profiles', case
             when maritime.user_id is null then null
             else json_build_object('rank', maritime.rank, 'current_company', maritime.current_company)
           end
         ) as profiles
       from public.post_comments c
       join public.profiles author on author.id = c.author_id
       left join public.maritime_profiles maritime on maritime.user_id = author.id
       where c.post_id = any($1::uuid[])
         and c.deleted_at is null
       order by c.created_at asc, c.id asc`,
      [postIds],
    ) as CommentRow[]
  }

  async function isMemberReady(profileId: string) {
    const rows = await queryRows(
      `select exists (
         select 1 from public.profiles p
         where p.id = $1
           and p.account_status = 'active'
           and p.onboarding_completed_at is not null
       ) as ready`,
      [profileId],
    ) as Array<QueryResultRow & { ready: boolean }>
    return Boolean(rows[0]?.ready)
  }

  async function getInteractablePost(input: { viewerProfileId: string; postId: string }) {
    const rows = await queryRows(
      `select p.id, p.author_id, p.post_type::text as post_type
       from public.posts p
       join public.profiles author on author.id = p.author_id
       where p.id = $1
         and p.deleted_at is null
         and exists (
           select 1 from public.profiles viewer
           where viewer.id = $2
             and viewer.account_status = 'active'
             and viewer.onboarding_completed_at is not null
         )
         and (
           p.author_id = $2
           or (
             author.account_status = 'active'
             and author.onboarding_completed_at is not null
             and not exists (
               select 1 from public.user_blocks b
               where (b.blocker_id = $2 and b.blocked_id = p.author_id)
                  or (b.blocker_id = p.author_id and b.blocked_id = $2)
             )
           )
         )
       limit 1`,
      [input.postId, input.viewerProfileId],
    ) as PostInteractionRow[]
    const row = rows[0]
    return row ? { id: row.id, authorId: row.author_id, postType: row.post_type } : null
  }

  async function insertStandardPost(input: { id: string; authorId: string; category: PostCategory; body: string }) {
    await queryRows(
      `insert into public.posts (id, author_id, category, body, post_type)
       values ($1, $2, $3, $4, 'standard')`,
      [input.id, input.authorId, input.category, input.body],
    )
  }

  async function insertPostMedia(postId: string, media: FeedMediaInput) {
    await queryRows(
      `insert into public.post_media (post_id, storage_path, mime_type, alt_text)
       values ($1, $2, $3, $4)`,
      [postId, media.storagePath, media.mimeType, media.altText],
    )
  }

  async function insertPollPost(input: { id: string; authorId: string; category: PostCategory; body: string }) {
    await queryRows(
      `insert into public.posts (id, author_id, category, body, post_type)
       values ($1, $2, $3, $4, 'poll')`,
      [input.id, input.authorId, input.category, input.body],
    )
    await queryRows(`insert into public.post_polls (post_id) values ($1)`, [input.id])
  }

  async function insertPollOption(postId: string, label: string, position: number) {
    await queryRows(
      `insert into public.post_poll_options (post_id, label, position) values ($1, $2, $3)`,
      [postId, label, position],
    )
  }

  async function setLiked(viewerProfileId: string, postId: string, liked: boolean) {
    if (liked) {
      await queryRows(
        `insert into public.post_reactions (post_id, user_id, reaction_type)
         values ($1, $2, 'like')
         on conflict (post_id, user_id) do nothing`,
        [postId, viewerProfileId],
      )
    } else {
      await queryRows(`delete from public.post_reactions where post_id = $1 and user_id = $2`, [postId, viewerProfileId])
    }
  }

  async function setSaved(viewerProfileId: string, postId: string, saved: boolean) {
    if (saved) {
      await queryRows(
        `insert into public.saved_posts (post_id, user_id)
         values ($1, $2)
         on conflict (post_id, user_id) do nothing`,
        [postId, viewerProfileId],
      )
    } else {
      await queryRows(`delete from public.saved_posts where post_id = $1 and user_id = $2`, [postId, viewerProfileId])
    }
  }

  async function addComment(viewerProfileId: string, postId: string, body: string) {
    await queryRows(
      `insert into public.post_comments (post_id, author_id, body) values ($1, $2, $3)`,
      [postId, viewerProfileId, body],
    )
  }

  async function setPollVote(viewerProfileId: string, postId: string, optionId: string) {
    await queryRows(
      `insert into public.post_poll_votes (post_id, option_id, user_id)
       values ($1, $2, $3)
       on conflict (post_id, user_id) do update set option_id = excluded.option_id`,
      [postId, optionId, viewerProfileId],
    )
  }

  async function pollOptionBelongsToPost(postId: string, optionId: string) {
    const rows = await queryRows(
      `select exists (
         select 1 from public.post_poll_options
         where post_id = $1 and id = $2
       ) as valid`,
      [postId, optionId],
    ) as Array<QueryResultRow & { valid: boolean }>
    return Boolean(rows[0]?.valid)
  }

  return {
    listFeedRows,
    getPostRow,
    getViewerState,
    getComments,
    isMemberReady,
    getInteractablePost,
    insertStandardPost,
    insertPostMedia,
    insertPollPost,
    insertPollOption,
    setLiked,
    setSaved,
    addComment,
    setPollVote,
    pollOptionBelongsToPost,
  }
}

export type FeedRepository = ReturnType<typeof createFeedRepository>

export function createFeedRepositoryForClient(client: DatabaseQueryClient) {
  return createFeedRepository({ query: async (text, values) => (await client.query(text, values)).rows })
}

export const feedRepository = createFeedRepository()

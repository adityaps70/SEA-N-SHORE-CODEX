import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import type { FeedCommentRow, FeedPostRow, FeedViewerState } from './mappers'
import type { FeedCursor, PostCategory, PostReactionType, ReactionTargetType } from './types'

type FeedQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type FeedRow = QueryResultRow & FeedPostRow
type CommentRow = QueryResultRow & FeedCommentRow
type PostInteractionRow = QueryResultRow & { id: string; author_id: string; post_type: 'standard' | 'poll' }
type CommentInteractionRow = QueryResultRow & {
  id: string
  post_id: string
  author_id: string
  parent_comment_id: string | null
  root_parent_id: string
  post_author_id: string
}
type PostStateRow = QueryResultRow & { post_id: string; option_id?: string; reaction_type?: PostReactionType }
type DeletedPostRow = QueryResultRow & { id: string }
type IdRow = QueryResultRow & { id: string }

export type ReactorRow = QueryResultRow & {
  profile_id: string
  slug: string | null
  full_name: string
  avatar_path: string | null
  headline: string | null
  rank: string | null
  current_company: string | null
  reaction_type: PostReactionType
  reacted_at: string
}

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

type ReactionDetailsLookup = {
  viewerProfileId: string
  targetType: ReactionTargetType
  targetId: string
  reaction?: PostReactionType
  cursor?: string
  limit: number
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
    json_build_object(
      'like', (select count(*)::int from public.post_reactions reaction where reaction.post_id = p.id and reaction.reaction_type = 'like'),
      'support', (select count(*)::int from public.post_reactions reaction where reaction.post_id = p.id and reaction.reaction_type = 'support'),
      'respect', (select count(*)::int from public.post_reactions reaction where reaction.post_id = p.id and reaction.reaction_type = 'respect'),
      'on_point', (select count(*)::int from public.post_reactions reaction where reaction.post_id = p.id and reaction.reaction_type = 'on_point')
    ) as post_reactions,
    coalesce((
      select json_agg(json_build_object(
        'profile_id', mentioned.id,
        'slug', mentioned.slug,
        'full_name', mentioned.full_name
      ) order by mention.created_at asc)
      from public.content_mentions mention
      join public.profiles mentioned on mentioned.id = mention.mentioned_profile_id
      where mention.post_id = p.id
    ), '[]'::json) as post_mentions,
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

function parseReactionCursor(cursor: string | undefined) {
  if (!cursor) return null
  const separator = cursor.lastIndexOf('|')
  if (separator <= 0) throw new Error('feed_reaction_cursor_invalid')
  const reactedAt = cursor.slice(0, separator)
  const profileId = cursor.slice(separator + 1)
  if (Number.isNaN(Date.parse(reactedAt)) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(profileId)) {
    throw new Error('feed_reaction_cursor_invalid')
  }
  return { reactedAt, profileId }
}

function reactionCursor(row: ReactorRow) {
  return `${row.reacted_at}|${row.profile_id}`
}

export function createFeedRepository(input: { query?: FeedQuery } = {}) {
  const queryRows: FeedQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  async function listFeedRows(lookup: FeedRowsLookup): Promise<FeedPostRow[]> {
    const values: unknown[] = [lookup.viewerProfileId]
    const clauses = ['p.deleted_at is null', visibilitySql()]
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
    return await queryRows(
      `${FEED_ROW_SELECT}
       where ${clauses.join('\n         and ')}
       order by p.created_at desc, p.id desc
       limit $${limitParameter}`,
      values,
    ) as FeedRow[]
  }

  async function listSavedRows(lookup: { viewerProfileId: string; limit: number }): Promise<FeedPostRow[]> {
    return await queryRows(
      `${FEED_ROW_SELECT}
       join public.saved_posts saved on saved.post_id = p.id
       where saved.user_id = $1
         and p.deleted_at is null
         and ${visibilitySql()}
       order by saved.created_at desc, p.id desc
       limit $2`,
      [lookup.viewerProfileId, lookup.limit],
    ) as FeedRow[]
  }

  async function listAuthorRows(lookup: { viewerProfileId: string; authorProfileId: string; limit?: number }): Promise<FeedPostRow[]> {
    const values: unknown[] = [lookup.viewerProfileId, lookup.authorProfileId]
    const limitSql = lookup.limit === undefined ? '' : ' limit $3'
    if (lookup.limit !== undefined) values.push(lookup.limit)
    return await queryRows(
      `${FEED_ROW_SELECT}
       where p.author_id = $2
         and p.deleted_at is null
         and ${visibilitySql()}
       order by p.created_at desc, p.id desc${limitSql}`,
      values,
    ) as FeedRow[]
  }

  async function listCommentedRows(lookup: { viewerProfileId: string; limit?: number }): Promise<FeedPostRow[]> {
    const values: unknown[] = [lookup.viewerProfileId]
    const limitSql = lookup.limit === undefined ? '' : ' limit $2'
    if (lookup.limit !== undefined) values.push(lookup.limit)
    return await queryRows(
      `${FEED_ROW_SELECT}
       join (
         select c.post_id, max(c.created_at) as last_commented_at
         from public.post_comments c
         where c.author_id = $1 and c.deleted_at is null
         group by c.post_id
       ) viewer_activity on viewer_activity.post_id = p.id
       where p.deleted_at is null and ${visibilitySql()}
       order by viewer_activity.last_commented_at desc, p.id desc${limitSql}`,
      values,
    ) as FeedRow[]
  }

  async function getPostRow(viewerProfileId: string, postId: string): Promise<FeedPostRow | null> {
    const rows = await queryRows(
      `${FEED_ROW_SELECT}
       where p.id = $2 and p.deleted_at is null and ${visibilitySql()}
       limit 1`,
      [viewerProfileId, postId],
    ) as FeedRow[]
    return rows[0] ?? null
  }

  async function getViewerState(viewerProfileId: string, postIds: string[]): Promise<FeedViewerState> {
    if (!postIds.length) return { postReactions: new Map(), likedPostIds: new Set(), savedPostIds: new Set(), pollVotes: new Map() }
    const reactions = await queryRows(
      `select post_id, reaction_type::text as reaction_type from public.post_reactions where user_id = $1 and post_id = any($2::uuid[])`,
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
      postReactions: new Map(reactions.map((row) => [row.post_id, row.reaction_type ?? 'like'] as const)),
      likedPostIds: new Set(reactions.filter((row) => !row.reaction_type || row.reaction_type === 'like').map((row) => row.post_id)),
      savedPostIds: new Set(saved.map((row) => row.post_id)),
      pollVotes: new Map(votes.flatMap((row) => row.option_id ? [[row.post_id, row.option_id] as const] : [])),
    }
  }

  async function listReactionDetails(lookup: ReactionDetailsLookup): Promise<{ rows: ReactorRow[]; nextCursor: string | null }> {
    const table = lookup.targetType === 'post' ? 'public.post_reactions' : 'public.comment_reactions'
    const targetColumn = lookup.targetType === 'post' ? 'post_id' : 'comment_id'
    const values: unknown[] = [lookup.viewerProfileId, lookup.targetId]
    const clauses = [
      `reaction.${targetColumn} = $2`,
      `reactor.account_status = 'active'`,
      `reactor.onboarding_completed_at is not null`,
      `exists (select 1 from public.profiles viewer where viewer.id = $1 and viewer.account_status = 'active' and viewer.onboarding_completed_at is not null)`,
      `not exists (
         select 1 from public.user_blocks b
         where (b.blocker_id = $1 and b.blocked_id = reaction.user_id)
            or (b.blocker_id = reaction.user_id and b.blocked_id = $1)
       )`,
    ]
    if (lookup.reaction) {
      values.push(lookup.reaction)
      clauses.push(`reaction.reaction_type = $${values.length}`)
    }
    const cursor = parseReactionCursor(lookup.cursor)
    if (cursor) {
      values.push(cursor.reactedAt)
      const reactedAtParameter = values.length
      values.push(cursor.profileId)
      const profileParameter = values.length
      clauses.push(`(reaction.created_at < $${reactedAtParameter} or (reaction.created_at = $${reactedAtParameter} and reaction.user_id < $${profileParameter}))`)
    }
    values.push(lookup.limit + 1)
    const limitParameter = values.length
    const rows = await queryRows(
      `select
         reaction.user_id as profile_id,
         reactor.slug,
         reactor.full_name,
         reactor.avatar_path,
         reactor.headline,
         maritime.rank,
         maritime.current_company,
         reaction.reaction_type::text as reaction_type,
         reaction.created_at as reacted_at
       from ${table} reaction
       join public.profiles reactor on reactor.id = reaction.user_id
       left join public.maritime_profiles maritime on maritime.user_id = reactor.id
       where ${clauses.join('\n         and ')}
       order by reaction.created_at desc, reaction.user_id desc
       limit $${limitParameter}`,
      values,
    ) as ReactorRow[]
    const hasMore = rows.length > lookup.limit
    const visibleRows = rows.slice(0, lookup.limit)
    return {
      rows: visibleRows,
      nextCursor: hasMore && visibleRows.length ? reactionCursor(visibleRows[visibleRows.length - 1]) : null,
    }
  }

  async function getComments(postIds: string[], viewerProfileId?: string): Promise<FeedCommentRow[]> {
    if (!postIds.length) return []
    const viewerSql = viewerProfileId
      ? `(select cr.reaction_type::text from public.comment_reactions cr where cr.comment_id = c.id and cr.user_id = $2 limit 1)`
      : `null::text`
    const ownershipSql = viewerProfileId
      ? `(c.author_id = $2) as viewer_owns,
         (c.author_id = $2 and c.deleted_at is null and now() < c.created_at + interval '15 minutes') as can_edit`
      : `false as viewer_owns,
         false as can_edit`
    const values: readonly unknown[] = viewerProfileId ? [postIds, viewerProfileId] : [postIds]
    return await queryRows(
      `select
         c.id, c.post_id, c.parent_comment_id, c.body, c.created_at, c.updated_at, c.deleted_at,
         json_build_object(
           'id', author.id,
           'slug', author.slug,
           'full_name', author.full_name,
           'avatar_path', author.avatar_path,
           'headline', author.headline,
           'maritime_profiles', case when maritime.user_id is null then null else json_build_object('rank', maritime.rank, 'current_company', maritime.current_company) end
         ) as profiles,
         json_build_object(
           'like', (select count(*)::int from public.comment_reactions cr where cr.comment_id = c.id and cr.reaction_type = 'like'),
           'support', (select count(*)::int from public.comment_reactions cr where cr.comment_id = c.id and cr.reaction_type = 'support'),
           'respect', (select count(*)::int from public.comment_reactions cr where cr.comment_id = c.id and cr.reaction_type = 'respect'),
           'on_point', (select count(*)::int from public.comment_reactions cr where cr.comment_id = c.id and cr.reaction_type = 'on_point')
         ) as reaction_summary,
         ${viewerSql} as viewer_reaction,
         ${ownershipSql},
         coalesce((
           select json_agg(json_build_object('profile_id', mentioned.id, 'slug', mentioned.slug, 'full_name', mentioned.full_name) order by mention.created_at asc)
           from public.content_mentions mention
           join public.profiles mentioned on mentioned.id = mention.mentioned_profile_id
           where mention.comment_id = c.id
         ), '[]'::json) as mentions
       from public.post_comments c
       join public.profiles author on author.id = c.author_id
       left join public.maritime_profiles maritime on maritime.user_id = author.id
       where c.post_id = any($1::uuid[]) and c.deleted_at is null
       order by c.created_at asc, c.id asc`,
      values,
    ) as CommentRow[]
  }

  async function listTopLevelComments(postId: string, viewerProfileId: string, offset: number, limit: number): Promise<FeedCommentRow[]> {
    const roots = await queryRows(
      `select c.id
       from public.post_comments c
       where c.post_id = $1 and c.parent_comment_id is null and c.deleted_at is null
       order by c.created_at desc, c.id desc
       offset $2 limit $3`,
      [postId, Math.max(0, offset), Math.min(Math.max(limit, 1), 20)],
    ) as IdRow[]
    if (!roots.length) return []
    const rootIds = roots.map((row) => row.id)
    const rows = await getComments([postId], viewerProfileId)
    const selected = new Set(rootIds)
    return rows.filter((row) => selected.has(row.id) || (row.parent_comment_id && selected.has(row.parent_comment_id)))
  }

  async function countTopLevelComments(postId: string) {
    const rows = await queryRows(
      `select count(*)::text as count from public.post_comments where post_id = $1 and parent_comment_id is null and deleted_at is null`,
      [postId],
    ) as Array<QueryResultRow & { count: string }>
    return Number(rows[0]?.count ?? 0)
  }

  async function isMemberReady(profileId: string) {
    const rows = await queryRows(
      `select exists (select 1 from public.profiles p where p.id = $1 and p.account_status = 'active' and p.onboarding_completed_at is not null) as ready`,
      [profileId],
    ) as Array<QueryResultRow & { ready: boolean }>
    return Boolean(rows[0]?.ready)
  }

  async function canMentionProfile(actorId: string, profileId: string) {
    if (actorId === profileId) return false
    const rows = await queryRows(
      `select exists (
         select 1 from public.profiles target
         where target.id = $2 and target.account_status = 'active' and target.onboarding_completed_at is not null
           and not exists (
             select 1 from public.user_blocks b
             where (b.blocker_id = $1 and b.blocked_id = $2) or (b.blocker_id = $2 and b.blocked_id = $1)
           )
       ) as allowed`,
      [actorId, profileId],
    ) as Array<QueryResultRow & { allowed: boolean }>
    return Boolean(rows[0]?.allowed)
  }

  async function getInteractablePost(input: { viewerProfileId: string; postId: string }) {
    const rows = await queryRows(
      `select p.id, p.author_id, p.post_type::text as post_type
       from public.posts p
       join public.profiles author on author.id = p.author_id
       where p.id = $1 and p.deleted_at is null
         and exists (select 1 from public.profiles viewer where viewer.id = $2 and viewer.account_status = 'active' and viewer.onboarding_completed_at is not null)
         and (p.author_id = $2 or (
           author.account_status = 'active' and author.onboarding_completed_at is not null
           and not exists (select 1 from public.user_blocks b where (b.blocker_id = $2 and b.blocked_id = p.author_id) or (b.blocker_id = p.author_id and b.blocked_id = $2))
         ))
       limit 1`,
      [input.postId, input.viewerProfileId],
    ) as PostInteractionRow[]
    const row = rows[0]
    return row ? { id: row.id, authorId: row.author_id, postType: row.post_type } : null
  }

  async function getCommentForInteraction(viewerProfileId: string, commentId: string) {
    const rows = await queryRows(
      `select c.id, c.post_id, c.author_id, c.parent_comment_id,
              coalesce(c.parent_comment_id, c.id) as root_parent_id,
              p.author_id as post_author_id
       from public.post_comments c
       join public.posts p on p.id = c.post_id
       join public.profiles author on author.id = c.author_id
       where c.id = $1 and c.deleted_at is null and p.deleted_at is null
         and exists (select 1 from public.profiles viewer where viewer.id = $2 and viewer.account_status = 'active' and viewer.onboarding_completed_at is not null)
         and not exists (select 1 from public.user_blocks b where (b.blocker_id = $2 and b.blocked_id = c.author_id) or (b.blocker_id = c.author_id and b.blocked_id = $2))
       limit 1`,
      [commentId, viewerProfileId],
    ) as CommentInteractionRow[]
    const row = rows[0]
    return row ? {
      id: row.id,
      postId: row.post_id,
      authorId: row.author_id,
      parentCommentId: row.parent_comment_id,
      rootParentId: row.root_parent_id,
      postAuthorId: row.post_author_id,
    } : null
  }

  async function deleteOwnPost(ownerProfileId: string, postId: string) {
    const rows = await queryRows(
      `update public.posts set deleted_at = now(), updated_at = now() where id = $2 and author_id = $1 and deleted_at is null returning id`,
      [ownerProfileId, postId],
    ) as DeletedPostRow[]
    return rows.length === 1
  }

  async function insertStandardPost(input: { id: string; authorId: string; category: PostCategory; body: string }) {
    await queryRows(`insert into public.posts (id, author_id, category, body, post_type) values ($1, $2, $3, $4, 'standard')`, [input.id, input.authorId, input.category, input.body])
  }

  async function insertPostMedia(postId: string, media: FeedMediaInput) {
    await queryRows(`insert into public.post_media (post_id, storage_path, mime_type, alt_text) values ($1, $2, $3, $4)`, [postId, media.storagePath, media.mimeType, media.altText])
  }

  async function isPostMediaAttached(storagePath: string) {
    const rows = await queryRows(`select exists (select 1 from public.post_media where storage_path = $1) as attached`, [storagePath]) as Array<QueryResultRow & { attached: boolean }>
    return Boolean(rows[0]?.attached)
  }

  async function insertPollPost(input: { id: string; authorId: string; category: PostCategory; body: string }) {
    await queryRows(`insert into public.posts (id, author_id, category, body, post_type) values ($1, $2, $3, $4, 'poll')`, [input.id, input.authorId, input.category, input.body])
    await queryRows(`insert into public.post_polls (post_id) values ($1)`, [input.id])
  }

  async function insertPollOption(postId: string, label: string, position: number) {
    await queryRows(`insert into public.post_poll_options (post_id, label, position) values ($1, $2, $3)`, [postId, label, position])
  }

  async function setPostReaction(viewerProfileId: string, postId: string, reaction: PostReactionType | null) {
    if (reaction) {
      await queryRows(
        `insert into public.post_reactions (post_id, user_id, reaction_type)
         values ($1, $2, $3)
         on conflict (post_id, user_id) do update set reaction_type = excluded.reaction_type, created_at = now()`,
        [postId, viewerProfileId, reaction],
      )
    } else {
      await queryRows(`delete from public.post_reactions where post_id = $1 and user_id = $2`, [postId, viewerProfileId])
    }
  }

  async function setLiked(viewerProfileId: string, postId: string, liked: boolean) {
    if (liked) {
      await queryRows(
        `insert into public.post_reactions (post_id, user_id, reaction_type) values ($1, $2, 'like') on conflict (post_id, user_id) do nothing`,
        [postId, viewerProfileId],
      )
    } else {
      await queryRows(`delete from public.post_reactions where post_id = $1 and user_id = $2`, [postId, viewerProfileId])
    }
  }

  async function setCommentReaction(viewerProfileId: string, commentId: string, reaction: PostReactionType | null) {
    if (reaction) {
      await queryRows(
        `insert into public.comment_reactions (comment_id, user_id, reaction_type)
         values ($1, $2, $3)
         on conflict (comment_id, user_id) do update set reaction_type = excluded.reaction_type, updated_at = now()`,
        [commentId, viewerProfileId, reaction],
      )
    } else {
      await queryRows(`delete from public.comment_reactions where comment_id = $1 and user_id = $2`, [commentId, viewerProfileId])
    }
  }

  async function setSaved(viewerProfileId: string, postId: string, saved: boolean) {
    if (saved) {
      await queryRows(`insert into public.saved_posts (post_id, user_id) values ($1, $2) on conflict (post_id, user_id) do nothing`, [postId, viewerProfileId])
    } else {
      await queryRows(`delete from public.saved_posts where post_id = $1 and user_id = $2`, [postId, viewerProfileId])
    }
  }

  async function addComment(viewerProfileId: string, postId: string, body: string, parentCommentId: string | null = null) {
    const rows = await queryRows(
      `insert into public.post_comments (post_id, author_id, body, parent_comment_id) values ($1, $2, $3, $4) returning id`,
      [postId, viewerProfileId, body, parentCommentId],
    ) as IdRow[]
    const id = rows[0]?.id
    if (!id) throw new Error('feed_comment_create_failed')
    return id
  }

  async function insertPostMentions(actorId: string, postId: string, mentionedProfileIds: string[]) {
    const inserted: string[] = []
    for (const profileId of [...new Set(mentionedProfileIds)]) {
      if (!await canMentionProfile(actorId, profileId)) continue
      const rows = await queryRows(
        `insert into public.content_mentions (id, actor_id, mentioned_profile_id, post_id)
         values ($1, $2, $3, $4)
         on conflict (post_id, mentioned_profile_id) where post_id is not null do nothing
         returning mentioned_profile_id as id`,
        [randomUUID(), actorId, profileId, postId],
      ) as IdRow[]
      if (rows[0]?.id) inserted.push(rows[0].id)
    }
    return inserted
  }

  async function insertCommentMentions(actorId: string, commentId: string, mentionedProfileIds: string[]) {
    const inserted: string[] = []
    for (const profileId of [...new Set(mentionedProfileIds)]) {
      if (!await canMentionProfile(actorId, profileId)) continue
      const rows = await queryRows(
        `insert into public.content_mentions (id, actor_id, mentioned_profile_id, comment_id)
         values ($1, $2, $3, $4)
         on conflict (comment_id, mentioned_profile_id) where comment_id is not null do nothing
         returning mentioned_profile_id as id`,
        [randomUUID(), actorId, profileId, commentId],
      ) as IdRow[]
      if (rows[0]?.id) inserted.push(rows[0].id)
    }
    return inserted
  }

  async function setPollVote(viewerProfileId: string, postId: string, optionId: string) {
    await queryRows(
      `insert into public.post_poll_votes (post_id, option_id, user_id) values ($1, $2, $3) on conflict (post_id, user_id) do update set option_id = excluded.option_id`,
      [postId, optionId, viewerProfileId],
    )
  }

  async function pollOptionBelongsToPost(postId: string, optionId: string) {
    const rows = await queryRows(`select exists (select 1 from public.post_poll_options where post_id = $1 and id = $2) as valid`, [postId, optionId]) as Array<QueryResultRow & { valid: boolean }>
    return Boolean(rows[0]?.valid)
  }

  return {
    listFeedRows,
    listSavedRows,
    listAuthorRows,
    listCommentedRows,
    getPostRow,
    getViewerState,
    listReactionDetails,
    getComments,
    listTopLevelComments,
    countTopLevelComments,
    isMemberReady,
    canMentionProfile,
    getInteractablePost,
    getCommentForInteraction,
    deleteOwnPost,
    insertStandardPost,
    insertPostMedia,
    isPostMediaAttached,
    insertPollPost,
    insertPollOption,
    setPostReaction,
    setLiked,
    setCommentReaction,
    setSaved,
    addComment,
    insertPostMentions,
    insertCommentMentions,
    setPollVote,
    pollOptionBelongsToPost,
  }
}

export type FeedRepository = ReturnType<typeof createFeedRepository>

export function createFeedRepositoryForClient(client: DatabaseQueryClient) {
  return createFeedRepository({ query: async (text, values) => (await client.query(text, values)).rows })
}

export const feedRepository = createFeedRepository()
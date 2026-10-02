import { randomUUID } from 'node:crypto'
import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import { hashtagBodySearchPattern } from '@/features/hashtags/parse'
import type { FeedCommentRow, FeedPostRow, FeedViewerState, HiddenPostSourceRow } from './mappers'
import type { FeedCursor, FeedPostType, PostCategory, PostReactionType, ReactionTargetType, RecentlyDeletedPost } from './types'

type FeedQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type FeedRow = QueryResultRow & FeedPostRow
type CommentRow = QueryResultRow & FeedCommentRow
type PostInteractionRow = QueryResultRow & { id: string; author_id: string; post_type: FeedPostType }
type PostManagementRow = QueryResultRow & {
  id: string
  author_id: string
  company_id: string | null
  post_type: FeedPostType
  body: string
}
type CompanyIdentityRow = QueryResultRow & { id: string; slug: string; name: string; logo_path: string | null }
type CompanyIdRow = QueryResultRow & { company_id: string | null }
type CommentInteractionRow = QueryResultRow & {
  id: string
  post_id: string
  author_id: string
  parent_comment_id: string | null
  root_parent_id: string
  post_author_id: string
}
type CommentMutationRow = QueryResultRow & {
  id: string
  post_id: string
  parent_comment_id: string | null
}
type PostStateRow = QueryResultRow & { post_id: string; option_id?: string; reaction_type?: PostReactionType }
type DeletedPostRow = QueryResultRow & { id: string }
type RecentlyDeletedPostRow = QueryResultRow & {
  id: string
  category: PostCategory
  body: string
  deleted_at: string
  purge_after: string
}
type IdRow = QueryResultRow & { id: string }

export type HiddenPostRow = QueryResultRow & HiddenPostSourceRow

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
  /** Only posts published as this organization. */
  companyId?: string
  /** Only posts published in this community group. */
  groupId?: string
  /** Only posts carrying this normalised hashtag; group posts stay out of hashtag pages. */
  hashtag?: string
  cursor?: FeedCursor
  limit: number
}

/** Members tagged in one uploaded photo, keyed by the photo's storage path. */
export type PhotoTagInput = {
  storagePath: string
  profileIds: string[]
}

export type FeedMediaInput = {
  storagePath: string
  mimeType: string
  altText: string | null
  position: number
  fileName: string
  pageCount: number | null
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
    p.repost_of_post_id,
    p.company_id,
    p.group_id,
    p.created_at,
    p.updated_at,
    case when post_group.id is null then null else json_build_object(
      'id', post_group.id,
      'slug', post_group.slug,
      'name', post_group.name,
      'visibility', post_group.visibility,
      'icon_path', post_group.icon_path
    ) end as post_group,
    case when post_company.id is null then null else json_build_object(
      'id', post_company.id,
      'slug', post_company.slug,
      'name', post_company.name,
      'logo_path', post_company.logo_path
    ) end as organization,
    (post_company.id is not null and exists (
      select 1 from public.organization_follows viewer_org_follow
      where viewer_org_follow.follower_id = $1 and viewer_org_follow.company_id = post_company.id
    )) as viewer_follows_organization,
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
    coalesce((
      select json_agg(
        json_build_object(
          'id', media.id,
          'storage_path', media.storage_path,
          'mime_type', media.mime_type,
          'alt_text', media.alt_text,
          'position', media.position,
          'file_name', media.file_name,
          'page_count', media.page_count
        )
        order by media.position asc, media.created_at asc, media.id asc
      )
      from public.post_media media
      where media.post_id = p.id
    ), '[]'::json) as post_media,
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
    coalesce((
      select json_agg(json_build_object(
        'company_id', mentioned_company.id,
        'slug', mentioned_company.slug,
        'name', mentioned_company.name,
        'logo_path', mentioned_company.logo_path
      ) order by org_mention.created_at asc)
      from public.content_organization_mentions org_mention
      join public.companies mentioned_company on mentioned_company.id = org_mention.company_id
      where org_mention.post_id = p.id
    ), '[]'::json) as post_organization_mentions,
    coalesce((
      select json_agg(hashtag.tag order by post_hashtag.position asc, hashtag.tag asc)
      from public.post_hashtags post_hashtag
      join public.hashtags hashtag on hashtag.id = post_hashtag.hashtag_id
      where post_hashtag.post_id = p.id
    ), '[]'::json) as post_hashtags,
    coalesce((
      select json_agg(json_build_object(
        'media_id', photo_tag.media_id,
        'profile_id', tagged.id,
        'slug', tagged.slug,
        'full_name', tagged.full_name,
        'avatar_path', tagged.avatar_path
      ) order by photo_tag.created_at asc, photo_tag.id asc)
      from public.post_photo_tags photo_tag
      join public.profiles tagged on tagged.id = photo_tag.tagged_profile_id
      where photo_tag.post_id = p.id
        and tagged.account_status = 'active'
        and not exists (
          select 1 from public.user_blocks tag_block
          where (tag_block.blocker_id = $1 and tag_block.blocked_id = tagged.id)
             or (tag_block.blocker_id = tagged.id and tag_block.blocked_id = $1)
        )
    ), '[]'::json) as post_photo_tags,
    json_build_object('count', (select count(*)::int from public.post_comments comment_count where comment_count.post_id = p.id and comment_count.deleted_at is null)) as post_comment_count,
    exists (
      select 1 from public.follows viewer_follow
      where viewer_follow.follower_id = $1 and viewer_follow.following_id = p.author_id
    ) as viewer_follows_author
  from public.posts p
  join public.profiles author on author.id = p.author_id
  left join public.maritime_profiles maritime on maritime.user_id = author.id
  left join public.companies post_company on post_company.id = p.company_id
  left join public.community_groups post_group on post_group.id = p.group_id
` as const

/**
 * Group posts: public groups are readable by every signed-in member, private groups only by
 * active members. Posts in archived groups leave every feed until the group is restored.
 */
function groupVisibilitySql(postRef = 'p') {
  return `
    (
      ${postRef}.group_id is null
      or exists (
        select 1 from public.community_groups visible_group
        where visible_group.id = ${postRef}.group_id
          and visible_group.archived_at is null
          and (
            visible_group.visibility = 'public'
            or exists (
              select 1 from public.community_group_memberships viewer_membership
              where viewer_membership.group_id = visible_group.id
                and viewer_membership.profile_id = $1
                and viewer_membership.status = 'active'
            )
          )
      )
    )
  `
}

function repostSourceVisibilitySql() {
  return `
    and (
      p.post_type <> 'repost'
      or exists (
        select 1
        from public.posts source
        join public.profiles source_author on source_author.id = source.author_id
        where source.id = p.repost_of_post_id
          and source.deleted_at is null
          and source.post_type <> 'repost'
          and ${groupVisibilitySql('source')}
          and (
            source.author_id = $1
            or (
              source_author.account_status = 'active'
              and source_author.onboarding_completed_at is not null
              and not exists (
                select 1 from public.user_blocks source_block
                where (source_block.blocker_id = $1 and source_block.blocked_id = source.author_id)
                   or (source_block.blocker_id = source.author_id and source_block.blocked_id = $1)
              )
            )
          )
      )
    )
  `
}

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
    and ${groupVisibilitySql()}
    ${repostSourceVisibilitySql()}
  `
}

/** Posts the viewer hid stay out of their feed, including reposts of a hidden original. */
function hiddenPostsSql() {
  return `
    not exists (
      select 1 from public.post_hides hidden
      where hidden.user_id = $1
        and (hidden.post_id = p.id or hidden.post_id = p.repost_of_post_id)
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

function mapCommentMutation(row: CommentMutationRow | undefined) {
  return row ? {
    id: row.id,
    postId: row.post_id,
    parentCommentId: row.parent_comment_id,
  } : null
}

export function createFeedRepository(input: { query?: FeedQuery } = {}) {
  const queryRows: FeedQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  async function listFeedRows(lookup: FeedRowsLookup): Promise<FeedPostRow[]> {
    const values: unknown[] = [lookup.viewerProfileId]
    const clauses = ['p.deleted_at is null', visibilitySql(), hiddenPostsSql()]
    if (lookup.category) {
      values.push(lookup.category)
      clauses.push(`p.category = $${values.length}`)
    }
    if (lookup.companyId) {
      values.push(lookup.companyId)
      clauses.push(`p.company_id = $${values.length}`)
    }
    if (lookup.groupId) {
      values.push(lookup.groupId)
      clauses.push(`p.group_id = $${values.length}`)
    }
    if (lookup.hashtag) {
      values.push(lookup.hashtag)
      const indexedTagParameter = values.length
      const bodyPattern = hashtagBodySearchPattern(lookup.hashtag)
      if (bodyPattern) {
        values.push(bodyPattern)
        const legacyBodyParameter = values.length
        clauses.push(`(
          exists (
            select 1 from public.post_hashtags tagged_post
            join public.hashtags tagged on tagged.id = tagged_post.hashtag_id
            where tagged_post.post_id = p.id and tagged.tag = ${indexedTagParameter}
          )
          or p.body ~* ${legacyBodyParameter}
        )`)
      } else {
        clauses.push(`exists (
          select 1 from public.post_hashtags tagged_post
          join public.hashtags tagged on tagged.id = tagged_post.hashtag_id
          where tagged_post.post_id = p.id and tagged.tag = ${indexedTagParameter}
        )`)
      }
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

  async function listAuthorRows(lookup: {
    viewerProfileId: string
    authorProfileId: string
    limit?: number
    /** Leave out posts published as an organization; they belong on the organization page. */
    personalOnly?: boolean
  }): Promise<FeedPostRow[]> {
    const values: unknown[] = [lookup.viewerProfileId, lookup.authorProfileId]
    const limitSql = lookup.limit === undefined ? '' : ' limit $3'
    if (lookup.limit !== undefined) values.push(lookup.limit)
    return await queryRows(
      `${FEED_ROW_SELECT}
       where p.author_id = $2
         and p.deleted_at is null${lookup.personalOnly ? '\n         and p.company_id is null' : ''}
         and ${visibilitySql()}
       order by p.created_at desc, p.id desc${limitSql}`,
      values,
    ) as FeedRow[]
  }

  async function listOwnRecentlyDeletedPosts(ownerProfileId: string): Promise<RecentlyDeletedPost[]> {
    const rows = await queryRows(
      `select
         p.id,
         p.category::text as category,
         p.body,
         p.deleted_at,
         p.purge_after
       from public.posts p
       where p.author_id = $1
         and p.deleted_by = $1
         and p.deleted_at is not null
         and p.purge_after > now()
       order by p.deleted_at desc, p.id desc`,
      [ownerProfileId],
    ) as RecentlyDeletedPostRow[]

    return rows.map((row) => ({
      id: row.id,
      category: row.category,
      body: row.body,
      deletedAt: row.deleted_at,
      purgeAfter: row.purge_after,
    }))
  }

  async function restoreOwnDeletedPost(ownerProfileId: string, postId: string) {
    const rows = await queryRows(
      `update public.posts
       set deleted_at = null,
           deleted_by = null,
           deletion_reason = null,
           purge_after = null,
           updated_at = now()
       where author_id = $1
         and id = $2
         and deleted_by = $1
         and deleted_at is not null
         and purge_after > now()
       returning id`,
      [ownerProfileId, postId],
    ) as DeletedPostRow[]
    if (rows.length !== 1) return false

    await queryRows(
      `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
       values ($1, 'content.post_restored_by_author', 'post', $2, '{}'::jsonb)`,
      [ownerProfileId, postId],
    )
    return true
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

  async function listRepostSourceRows(viewerProfileId: string, postIds: string[]): Promise<FeedPostRow[]> {
    if (!postIds.length) return []
    return await queryRows(
      `${FEED_ROW_SELECT}
       where p.id = any($2::uuid[])
         and p.deleted_at is null
         and p.post_type <> 'repost'
         and ${visibilitySql()}`,
      [viewerProfileId, postIds],
    ) as FeedRow[]
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
      ? `case when c.deleted_at is null then (select cr.reaction_type::text from public.comment_reactions cr where cr.comment_id = c.id and cr.user_id = $2 limit 1) else null::text end`
      : `null::text`
    const ownershipSql = viewerProfileId
      ? `(c.deleted_at is null and c.author_id = $2) as viewer_owns,
         (c.author_id = $2 and c.deleted_at is null and now() < c.created_at + interval '15 minutes') as can_edit`
      : `false as viewer_owns,
         false as can_edit`
    const values: readonly unknown[] = viewerProfileId ? [postIds, viewerProfileId] : [postIds]
    return await queryRows(
      `select
         c.id, c.post_id, c.parent_comment_id,
         case when reply_target.id is null then null else json_build_object(
           'comment_id', reply_target.id,
           'author_name', reply_target_author.full_name,
           'author_slug', reply_target_author.slug
         ) end as reply_to,
         case when c.deleted_at is null then c.body else '' end as body,
         c.created_at, c.updated_at, c.deleted_at,
         json_build_object(
           'id', author.id,
           'slug', author.slug,
           'full_name', author.full_name,
           'avatar_path', author.avatar_path,
           'headline', author.headline,
           'maritime_profiles', case when maritime.user_id is null then null else json_build_object('rank', maritime.rank, 'current_company', maritime.current_company) end
         ) as profiles,
         case when c.deleted_at is null then json_build_object(
           'like', (select count(*)::int from public.comment_reactions cr where cr.comment_id = c.id and cr.reaction_type = 'like'),
           'support', (select count(*)::int from public.comment_reactions cr where cr.comment_id = c.id and cr.reaction_type = 'support'),
           'respect', (select count(*)::int from public.comment_reactions cr where cr.comment_id = c.id and cr.reaction_type = 'respect'),
           'on_point', (select count(*)::int from public.comment_reactions cr where cr.comment_id = c.id and cr.reaction_type = 'on_point')
         ) else json_build_object('like', 0, 'support', 0, 'respect', 0, 'on_point', 0) end as reaction_summary,
         ${viewerSql} as viewer_reaction,
         ${ownershipSql},
         case when c.deleted_at is null then coalesce((
           select json_agg(json_build_object('profile_id', mentioned.id, 'slug', mentioned.slug, 'full_name', mentioned.full_name) order by mention.created_at asc)
           from public.content_mentions mention
           join public.profiles mentioned on mentioned.id = mention.mentioned_profile_id
           where mention.comment_id = c.id
         ), '[]'::json) else '[]'::json end as mentions,
         case when c.deleted_at is null then coalesce((
           select json_agg(json_build_object('company_id', mentioned_company.id, 'slug', mentioned_company.slug, 'name', mentioned_company.name, 'logo_path', mentioned_company.logo_path) order by org_mention.created_at asc)
           from public.content_organization_mentions org_mention
           join public.companies mentioned_company on mentioned_company.id = org_mention.company_id
           where org_mention.comment_id = c.id
         ), '[]'::json) else '[]'::json end as organization_mentions
       from public.post_comments c
       join public.profiles author on author.id = c.author_id
       left join public.maritime_profiles maritime on maritime.user_id = author.id
       left join public.post_comments reply_target on reply_target.id = c.reply_to_comment_id
       left join public.profiles reply_target_author on reply_target_author.id = reply_target.author_id
       where c.post_id = any($1::uuid[])
         and (
           c.deleted_at is null
           or (c.parent_comment_id is null and exists (
             select 1 from public.post_comments reply
             where reply.parent_comment_id = c.id and reply.deleted_at is null
           ))
         )
       order by c.created_at asc, c.id asc`,
      values,
    ) as CommentRow[]
  }

  async function listTopLevelComments(postId: string, viewerProfileId: string, offset: number, limit: number): Promise<FeedCommentRow[]> {
    const roots = await queryRows(
      `select c.id
       from public.post_comments c
       where c.post_id = $1 and c.parent_comment_id is null
         and (c.deleted_at is null or exists (
           select 1 from public.post_comments reply
           where reply.parent_comment_id = c.id and reply.deleted_at is null
         ))
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
      `select count(*)::text as count
       from public.post_comments c
       where c.post_id = $1 and c.parent_comment_id is null
         and (c.deleted_at is null or exists (
           select 1 from public.post_comments reply
           where reply.parent_comment_id = c.id and reply.deleted_at is null
         ))`,
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
         and (
           p.post_type <> 'repost'
           or exists (
             select 1
             from public.posts source
             join public.profiles source_author on source_author.id = source.author_id
             where source.id = p.repost_of_post_id
               and source.deleted_at is null
               and source.post_type <> 'repost'
               and (source.author_id = $2 or (
                 source_author.account_status = 'active'
                 and source_author.onboarding_completed_at is not null
                 and not exists (select 1 from public.user_blocks source_block where (source_block.blocker_id = $2 and source_block.blocked_id = source.author_id) or (source_block.blocker_id = source.author_id and source_block.blocked_id = $2))
               ))
           )
         )
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

  /** The stored author and organization of a live post, for edit and delete checks. */
  async function getPostForManagement(postId: string) {
    const rows = await queryRows(
      `select p.id, p.author_id, p.company_id, p.post_type::text as post_type, p.body
       from public.posts p
       where p.id = $1 and p.deleted_at is null
       limit 1`,
      [postId],
    ) as PostManagementRow[]
    const row = rows[0]
    return row ? {
      id: row.id,
      authorId: row.author_id,
      companyId: row.company_id ?? null,
      postType: row.post_type,
      body: row.body,
    } : null
  }

  /** Organization of a post the author deleted and can still restore (null for personal posts). */
  async function getRestorablePostCompanyId(ownerProfileId: string, postId: string) {
    const rows = await queryRows(
      `select p.company_id
       from public.posts p
       where p.author_id = $1
         and p.id = $2
         and p.deleted_by = $1
         and p.deleted_at is not null
         and p.purge_after > now()
       limit 1`,
      [ownerProfileId, postId],
    ) as CompanyIdRow[]
    return rows[0]?.company_id ?? null
  }

  /** Organization admins remove a post published as their organization. */
  async function deleteOrganizationPost(actorProfileId: string, postId: string, companyId: string) {
    const rows = await queryRows(
      `update public.posts
       set deleted_at = now(),
           deleted_by = $1,
           deletion_reason = 'Deleted by an organization administrator.',
           purge_after = now() + interval '30 days',
           updated_at = now()
       where id = $2
         and company_id = $3
         and deleted_at is null
       returning id`,
      [actorProfileId, postId, companyId],
    ) as DeletedPostRow[]
    if (rows.length !== 1) return false
    await queryRows(
      `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
       values ($1, 'content.post_deleted_by_organization_admin', 'post', $2, jsonb_build_object('company_id', $3::text))`,
      [actorProfileId, postId, companyId],
    )
    return true
  }

  async function updatePostBody(postId: string, body: string) {
    const rows = await queryRows(
      `update public.posts
       set body = $2,
           updated_at = now()
       where id = $1 and deleted_at is null
       returning id`,
      [postId, body],
    ) as IdRow[]
    return rows.length === 1
  }

  async function replacePostMentions(actorId: string, postId: string, mentionedProfileIds: string[]) {
    const previousRows = await queryRows(
      `select mentioned_profile_id as id from public.content_mentions where post_id = $1`,
      [postId],
    ) as IdRow[]
    const previousIds = new Set(previousRows.map((row) => row.id))
    await queryRows(`delete from public.content_mentions where post_id = $1`, [postId])
    const mentionProfileIds = await insertPostMentions(actorId, postId, mentionedProfileIds)
    return {
      mentionProfileIds,
      newlyIntroducedProfileIds: mentionProfileIds.filter((profileId) => !previousIds.has(profileId)),
    }
  }

  /** Name, slug and logo of the organizations a member may post for. */
  async function listCompanyIdentities(companyIds: string[]) {
    if (!companyIds.length) return []
    const rows = await queryRows(
      `select c.id, c.slug, c.name, c.logo_path
       from public.companies c
       where c.id = any($1::uuid[])
       order by c.name asc, c.id asc`,
      [companyIds],
    ) as CompanyIdentityRow[]
    return rows.map((row) => ({ id: row.id, slug: row.slug, name: row.name, logoPath: row.logo_path }))
  }

  async function deleteOwnPost(ownerProfileId: string, postId: string) {
    const rows = await queryRows(
      `update public.posts
       set deleted_at = now(),
           deleted_by = $1,
           deletion_reason = 'Deleted by post author.',
           purge_after = now() + interval '30 days',
           updated_at = now()
       where id = $2
         and author_id = $1
         and deleted_at is null
       returning id`,
      [ownerProfileId, postId],
    ) as DeletedPostRow[]
    return rows.length === 1
  }

  async function updateOwnCommentWithinEditWindow(ownerProfileId: string, commentId: string, body: string) {
    const rows = await queryRows(
      `update public.post_comments
       set body = $3
       where author_id = $1 and id = $2 and deleted_at is null
         and now() < created_at + interval '15 minutes'
       returning id, post_id, parent_comment_id`,
      [ownerProfileId, commentId, body],
    ) as CommentMutationRow[]
    return mapCommentMutation(rows[0])
  }

  async function softDeleteOwnComment(ownerProfileId: string, commentId: string) {
    const rows = await queryRows(
      `update public.post_comments
       set deleted_at = now()
       where author_id = $1 and id = $2 and deleted_at is null
       returning id, post_id, parent_comment_id`,
      [ownerProfileId, commentId],
    ) as CommentMutationRow[]
    return mapCommentMutation(rows[0])
  }

  async function insertStandardPost(input: { id: string; authorId: string; category: PostCategory; body: string; companyId?: string; groupId?: string }) {
    if (input.groupId) {
      await queryRows(
        `insert into public.posts (id, author_id, category, body, post_type, company_id, group_id) values ($1, $2, $3, $4, 'standard', $5, $6)`,
        [input.id, input.authorId, input.category, input.body, input.companyId ?? null, input.groupId],
      )
      return
    }
    if (input.companyId) {
      await queryRows(
        `insert into public.posts (id, author_id, category, body, post_type, company_id) values ($1, $2, $3, $4, 'standard', $5)`,
        [input.id, input.authorId, input.category, input.body, input.companyId],
      )
      return
    }
    await queryRows(`insert into public.posts (id, author_id, category, body, post_type) values ($1, $2, $3, $4, 'standard')`, [input.id, input.authorId, input.category, input.body])
  }

  /** Active membership (any role) in a live group; group admins/owners count as members. */
  async function getGroupPostingAccess(actorId: string, groupId: string) {
    const rows = await queryRows(
      `select g.id, g.slug, g.name, g.visibility, g.archived_at,
              (select m.role from public.community_group_memberships m where m.group_id = g.id and m.profile_id = $1 and m.status = 'active') as member_role
       from public.community_groups g
       where g.id = $2`,
      [actorId, groupId],
    ) as Array<QueryResultRow & { id: string; slug: string; name: string; visibility: 'public' | 'private'; archived_at: string | null; member_role: string | null }>
    const row = rows[0]
    if (!row) return null
    return { id: row.id, slug: row.slug, name: row.name, visibility: row.visibility, archived: Boolean(row.archived_at), memberRole: row.member_role }
  }

  /** Profile ids of a group's active admins and owners. */
  async function listGroupAdminIds(groupId: string) {
    const rows = await queryRows(
      `select m.profile_id as id
       from public.community_group_memberships m
       join public.profiles admin on admin.id = m.profile_id
       where m.group_id = $1 and m.status = 'active' and m.role in ('admin', 'owner') and admin.account_status = 'active'`,
      [groupId],
    ) as IdRow[]
    return rows.map((row) => row.id)
  }

  /** Approved owners/administrators of the given organizations, keyed by company id. */
  async function listOrganizationAdminIds(companyIds: string[]) {
    const result = new Map<string, string[]>()
    if (!companyIds.length) return result
    const rows = await queryRows(
      `select cm.company_id, cm.user_id as id
       from public.company_members cm
       join public.profiles admin on admin.id = cm.user_id
       where cm.company_id = any($1::uuid[])
         and cm.approved_at is not null
         and cm.role::text in ('owner', 'administrator')
         and admin.account_status = 'active'`,
      [companyIds],
    ) as Array<QueryResultRow & { company_id: string; id: string }>
    for (const row of rows) {
      const list = result.get(row.company_id) ?? []
      list.push(row.id)
      result.set(row.company_id, list)
    }
    return result
  }

  /** Organizations that can be tagged: live, not suspended. Returns the ids that exist. */
  async function insertOrganizationMentions(actorId: string, target: { postId: string } | { commentId: string }, companyIds: string[]) {
    const inserted: string[] = []
    for (const companyId of [...new Set(companyIds)]) {
      const rows = await queryRows(
        'postId' in target
          ? `insert into public.content_organization_mentions (actor_id, company_id, post_id)
             select $1, c.id, $3 from public.companies c where c.id = $2
             on conflict (post_id, company_id) where post_id is not null do nothing
             returning company_id as id`
          : `insert into public.content_organization_mentions (actor_id, company_id, comment_id)
             select $1, c.id, $3 from public.companies c where c.id = $2
             on conflict (comment_id, company_id) where comment_id is not null do nothing
             returning company_id as id`,
        [actorId, companyId, 'postId' in target ? target.postId : target.commentId],
      ) as IdRow[]
      if (rows[0]?.id) inserted.push(rows[0].id)
    }
    return inserted
  }

  async function replaceOrganizationMentions(actorId: string, target: { postId: string } | { commentId: string }, companyIds: string[]) {
    const wanted = [...new Set(companyIds)]
    if ('postId' in target) {
      await queryRows(`delete from public.content_organization_mentions where post_id = $1 and not (company_id = any($2::uuid[]))`, [target.postId, wanted])
    } else {
      await queryRows(`delete from public.content_organization_mentions where comment_id = $1 and not (company_id = any($2::uuid[]))`, [target.commentId, wanted])
    }
    return wanted.length ? await insertOrganizationMentions(actorId, target, wanted) : []
  }

  /** Stores normalised hashtags for a post (creating unknown tags) and returns the tags kept. */
  async function replacePostHashtags(postId: string, tags: string[]) {
    const wanted = [...new Set(tags.map((tag) => tag.toLowerCase()).filter((tag) => /^[a-z0-9_]{1,64}$/.test(tag)))]
    await queryRows(
      `delete from public.post_hashtags
       where post_id = $1
         and hashtag_id not in (select h.id from public.hashtags h where h.tag = any($2::text[]))`,
      [postId, wanted],
    )
    for (const [position, tag] of wanted.entries()) {
      await queryRows(`insert into public.hashtags (tag) values ($1) on conflict (tag) do nothing`, [tag])
      await queryRows(
        `insert into public.post_hashtags (post_id, hashtag_id, position)
         select $1, h.id, $3 from public.hashtags h where h.tag = $2
         on conflict (post_id, hashtag_id) do update set position = excluded.position`,
        [postId, tag, position],
      )
    }
    return wanted
  }

  /** Tags members in the post's photos. Blocked pairs and unready members are skipped. */
  async function insertPhotoTags(actorId: string, postId: string, tags: PhotoTagInput[]) {
    const inserted: Array<{ mediaId: string; profileId: string }> = []
    for (const tag of tags) {
      const mediaRows = await queryRows(
        `select id from public.post_media where post_id = $1 and storage_path = $2 and mime_type like 'image/%'`,
        [postId, tag.storagePath],
      ) as IdRow[]
      const mediaId = mediaRows[0]?.id
      if (!mediaId) continue
      for (const profileId of [...new Set(tag.profileIds)]) {
        if (profileId !== actorId && !await canMentionProfile(actorId, profileId)) continue
        const rows = await queryRows(
          `insert into public.post_photo_tags (post_id, media_id, tagged_profile_id, tagged_by)
           values ($1, $2, $3, $4)
           on conflict (media_id, tagged_profile_id) do nothing
           returning tagged_profile_id as id`,
          [postId, mediaId, profileId, actorId],
        ) as IdRow[]
        if (rows[0]?.id) inserted.push({ mediaId, profileId: rows[0].id })
      }
    }
    return inserted
  }

  /** A tagged member removes their own tag, or the post author removes any tag. */
  async function deletePhotoTag(actorId: string, postId: string, mediaId: string, profileId: string) {
    const rows = await queryRows(
      `delete from public.post_photo_tags tag
       using public.posts p
       where tag.post_id = $2 and tag.media_id = $3 and tag.tagged_profile_id = $4
         and p.id = tag.post_id
         and ($1 = tag.tagged_profile_id or $1 = p.author_id)
       returning tag.tagged_profile_id as id`,
      [actorId, postId, mediaId, profileId],
    ) as IdRow[]
    return rows.length > 0
  }

  async function insertPostMedia(postId: string, media: FeedMediaInput) {
    await queryRows(
      `insert into public.post_media (post_id, storage_path, mime_type, alt_text, position, file_name, page_count)
       values ($1, $2, $3, $4, $5, $6, $7)`,
      [postId, media.storagePath, media.mimeType, media.altText, media.position, media.fileName, media.pageCount],
    )
  }

  async function isPostMediaAttached(storagePath: string) {
    const rows = await queryRows(`select exists (select 1 from public.post_media where storage_path = $1) as attached`, [storagePath]) as Array<QueryResultRow & { attached: boolean }>
    return Boolean(rows[0]?.attached)
  }

  async function insertPollPost(input: { id: string; authorId: string; category: PostCategory; body: string; companyId?: string; groupId?: string }) {
    if (input.groupId) {
      await queryRows(
        `insert into public.posts (id, author_id, category, body, post_type, company_id, group_id) values ($1, $2, $3, $4, 'poll', $5, $6)`,
        [input.id, input.authorId, input.category, input.body, input.companyId ?? null, input.groupId],
      )
    } else if (input.companyId) {
      await queryRows(
        `insert into public.posts (id, author_id, category, body, post_type, company_id) values ($1, $2, $3, $4, 'poll', $5)`,
        [input.id, input.authorId, input.category, input.body, input.companyId],
      )
    } else {
      await queryRows(`insert into public.posts (id, author_id, category, body, post_type) values ($1, $2, $3, $4, 'poll')`, [input.id, input.authorId, input.category, input.body])
    }
    await queryRows(`insert into public.post_polls (post_id) values ($1)`, [input.id])
  }

  async function insertPollOption(postId: string, label: string, position: number) {
    await queryRows(`insert into public.post_poll_options (post_id, label, position) values ($1, $2, $3)`, [postId, label, position])
  }

  async function insertRepost(input: { id: string; authorId: string; sourcePostId: string; body?: string }) {
    const commentary = input.body?.trim() ?? ''
    const rows = commentary
      ? await queryRows(
        `insert into public.posts (id, author_id, category, body, post_type, repost_of_post_id)
         select $1, $2, source.category, $4, 'repost', source.id
         from public.posts source
         where source.id = $3
           and source.deleted_at is null
           and source.post_type <> 'repost'
         on conflict (author_id, repost_of_post_id) where post_type = 'repost' and deleted_at is null do nothing
         returning id`,
        [input.id, input.authorId, input.sourcePostId, commentary],
      ) as IdRow[]
      : await queryRows(
        `insert into public.posts (id, author_id, category, body, post_type, repost_of_post_id)
         select $1, $2, source.category, '', 'repost', source.id
         from public.posts source
         where source.id = $3
           and source.deleted_at is null
           and source.post_type <> 'repost'
         on conflict (author_id, repost_of_post_id) where post_type = 'repost' and deleted_at is null do nothing
         returning id`,
        [input.id, input.authorId, input.sourcePostId],
      ) as IdRow[]
    if (!rows[0]?.id) throw new Error('feed_repost_duplicate')
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

  async function setHidden(viewerProfileId: string, postId: string, hidden: boolean) {
    if (hidden) {
      await queryRows(
        `insert into public.post_hides (user_id, post_id) values ($1, $2) on conflict (user_id, post_id) do nothing`,
        [viewerProfileId, postId],
      )
    } else {
      await queryRows(`delete from public.post_hides where user_id = $1 and post_id = $2`, [viewerProfileId, postId])
    }
  }

  /**
   * Posts the viewer hid, newest hide first, with just enough for a compact preview: author,
   * organization, text (the original's for plain reposts) and the first photo or video.
   * Deleted posts and posts by blocked or inactive members are left out.
   */
  async function listHiddenPosts(viewerProfileId: string, limit = 50): Promise<HiddenPostRow[]> {
    return await queryRows(
      `select
         p.id,
         p.body,
         p.post_type::text as post_type,
         p.created_at,
         hidden.created_at as hidden_at,
         author.id as author_id,
         author.slug as author_slug,
         author.full_name as author_name,
         author.avatar_path as author_avatar_path,
         company.id as company_id,
         company.slug as company_slug,
         company.name as company_name,
         company.logo_path as company_logo_path,
         source.body as source_body,
         first_media.storage_path as media_path,
         first_media.mime_type as media_mime_type
       from public.post_hides hidden
       join public.posts p on p.id = hidden.post_id
       join public.profiles author on author.id = p.author_id
       left join public.companies company on company.id = p.company_id
       left join public.posts source on source.id = p.repost_of_post_id and source.deleted_at is null
       left join lateral (
         select media.storage_path, media.mime_type
         from public.post_media media
         where media.post_id = coalesce(p.repost_of_post_id, p.id)
         order by media.position asc, media.created_at asc, media.id asc
         limit 1
       ) first_media on true
       where hidden.user_id = $1
         and p.deleted_at is null
         and author.account_status = 'active'
         and not exists (
           select 1 from public.user_blocks b
           where (b.blocker_id = $1 and b.blocked_id = p.author_id)
              or (b.blocker_id = p.author_id and b.blocked_id = $1)
         )
       order by hidden.created_at desc, p.id desc
       limit $2`,
      [viewerProfileId, Math.min(Math.max(Math.trunc(limit), 1), 100)],
    ) as HiddenPostRow[]
  }

  /** Removes one of the viewer's hides. Returns false when the post was not hidden. */
  async function deleteHide(viewerProfileId: string, postId: string): Promise<boolean> {
    const rows = await queryRows(
      `delete from public.post_hides where user_id = $1 and post_id = $2 returning post_id as id`,
      [viewerProfileId, postId],
    ) as IdRow[]
    return rows.length > 0
  }

  async function setSaved(viewerProfileId: string, postId: string, saved: boolean) {
    if (saved) {
      await queryRows(`insert into public.saved_posts (post_id, user_id) values ($1, $2) on conflict (post_id, user_id) do nothing`, [postId, viewerProfileId])
    } else {
      await queryRows(`delete from public.saved_posts where post_id = $1 and user_id = $2`, [postId, viewerProfileId])
    }
  }

  async function addComment(
    viewerProfileId: string,
    postId: string,
    body: string,
    parentCommentId: string | null = null,
    replyToCommentId: string | null = null,
  ) {
    const rows = replyToCommentId
      ? await queryRows(
        `insert into public.post_comments (post_id, author_id, body, parent_comment_id, reply_to_comment_id) values ($1, $2, $3, $4, $5) returning id`,
        [postId, viewerProfileId, body, parentCommentId, replyToCommentId],
      ) as IdRow[]
      : await queryRows(
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

  async function replaceCommentMentions(actorId: string, commentId: string, mentionedProfileIds: string[]) {
    const previousRows = await queryRows(
      `select mentioned_profile_id as id from public.content_mentions where comment_id = $1`,
      [commentId],
    ) as IdRow[]
    const previousIds = new Set(previousRows.map((row) => row.id))
    await queryRows(`delete from public.content_mentions where comment_id = $1`, [commentId])

    const mentionProfileIds: string[] = []
    for (const profileId of [...new Set(mentionedProfileIds)]) {
      if (!await canMentionProfile(actorId, profileId)) continue
      const rows = await queryRows(
        `insert into public.content_mentions (id, actor_id, mentioned_profile_id, comment_id)
         values ($1, $2, $3, $4)
         on conflict (comment_id, mentioned_profile_id) where comment_id is not null do nothing
         returning mentioned_profile_id as id`,
        [randomUUID(), actorId, profileId, commentId],
      ) as IdRow[]
      if (rows[0]?.id) mentionProfileIds.push(rows[0].id)
    }
    return {
      mentionProfileIds,
      newlyIntroducedProfileIds: mentionProfileIds.filter((profileId) => !previousIds.has(profileId)),
    }
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
    listOwnRecentlyDeletedPosts,
    restoreOwnDeletedPost,
    listCommentedRows,
    getPostRow,
    listRepostSourceRows,
    getViewerState,
    listReactionDetails,
    getComments,
    listTopLevelComments,
    countTopLevelComments,
    isMemberReady,
    canMentionProfile,
    getInteractablePost,
    getCommentForInteraction,
    getPostForManagement,
    getRestorablePostCompanyId,
    deleteOrganizationPost,
    updatePostBody,
    replacePostMentions,
    listCompanyIdentities,
    deleteOwnPost,
    updateOwnCommentWithinEditWindow,
    softDeleteOwnComment,
    insertStandardPost,
    getGroupPostingAccess,
    listGroupAdminIds,
    listOrganizationAdminIds,
    insertOrganizationMentions,
    replaceOrganizationMentions,
    replacePostHashtags,
    insertPhotoTags,
    deletePhotoTag,
    insertPostMedia,
    isPostMediaAttached,
    insertPollPost,
    insertPollOption,
    insertRepost,
    setPostReaction,
    setLiked,
    setCommentReaction,
    setSaved,
    setHidden,
    listHiddenPosts,
    deleteHide,
    addComment,
    insertPostMentions,
    insertCommentMentions,
    replaceCommentMentions,
    setPollVote,
    pollOptionBelongsToPost,
  }
}

export type FeedRepository = ReturnType<typeof createFeedRepository>

export function createFeedRepositoryForClient(client: DatabaseQueryClient) {
  return createFeedRepository({ query: async (text, values) => (await client.query(text, values)).rows })
}

export const feedRepository = createFeedRepository()

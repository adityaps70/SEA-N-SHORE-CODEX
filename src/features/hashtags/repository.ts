import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { isStorableHashtag, normaliseHashtag } from './parse'

/**
 * Hashtags (round 9B): `public.hashtags` holds every tag ever used, normalised (lower-case,
 * no "#"); `public.post_hashtags` links posts to them and `public.hashtag_follows` records
 * who follows a tag. Post counts only count live posts in the open feed (group posts stay
 * inside their group), matching what the hashtag page shows.
 */

export type HashtagSuggestion = {
  tag: string
  postCount: number
}

export type HashtagSummary = {
  tag: string
  postCount: number
  followerCount: number
}

export const HASHTAG_SUGGESTIONS_LIMIT = 8

type HashtagQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type HashtagSuggestionRow = QueryResultRow & { tag: string; post_count: number | string | null }
type HashtagSummaryRow = QueryResultRow & { tag: string; post_count: number | string | null; follower_count: number | string | null }

function count(value: number | string | null | undefined) {
  const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value ?? 0
  return Number.isFinite(parsed) ? Number(parsed) : 0
}

/** Escapes LIKE wildcards: "_" is a valid tag character, so "#life_" must not match everything. */
function likeLiteral(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

const LIVE_PUBLIC_POSTS_SQL = `select count(*)::int
  from public.post_hashtags ph
  join public.posts p on p.id = ph.post_id
  where ph.hashtag_id = h.id and p.deleted_at is null and p.group_id is null`

export function createHashtagRepository(input: { query?: HashtagQuery } = {}) {
  const queryRows: HashtagQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  /** Existing tags starting with the typed text, most used first. An empty query lists the most used tags. */
  async function searchHashtags(query: string, limit = HASHTAG_SUGGESTIONS_LIMIT): Promise<HashtagSuggestion[]> {
    const prefix = normaliseHashtag(query).slice(0, 64)
    if (prefix && !isStorableHashtag(prefix)) return []
    const rows = await queryRows(
      `select h.tag, (${LIVE_PUBLIC_POSTS_SQL}) as post_count
       from public.hashtags h
       where h.tag like $1 escape '\\'
       order by post_count desc, h.tag asc
       limit $2`,
      [`${likeLiteral(prefix)}%`, Math.max(1, Math.min(limit, 50))],
    ) as HashtagSuggestionRow[]
    return rows.map((row) => ({ tag: row.tag, postCount: count(row.post_count) }))
  }

  /** Post and follower counts for one tag, or null when nobody has used it yet. */
  async function getHashtagSummary(tag: string): Promise<HashtagSummary | null> {
    const normalised = normaliseHashtag(tag)
    if (!isStorableHashtag(normalised)) return null
    const rows = await queryRows(
      `select h.tag,
              (${LIVE_PUBLIC_POSTS_SQL}) as post_count,
              (select count(*)::int from public.hashtag_follows hf where hf.hashtag_id = h.id) as follower_count
       from public.hashtags h
       where h.tag = $1`,
      [normalised],
    ) as HashtagSummaryRow[]
    const row = rows[0]
    if (!row?.tag) return null
    return { tag: row.tag, postCount: count(row.post_count), followerCount: count(row.follower_count) }
  }

  /** Follows a tag, creating the tag row when it has never been used in a post yet. */
  async function followHashtag(profileId: string, tag: string) {
    const normalised = normaliseHashtag(tag)
    if (!isStorableHashtag(normalised)) return false
    await queryRows(`insert into public.hashtags (tag) values ($1) on conflict (tag) do nothing`, [normalised])
    await queryRows(
      `insert into public.hashtag_follows (profile_id, hashtag_id)
       select $1, h.id from public.hashtags h where h.tag = $2
       on conflict (profile_id, hashtag_id) do nothing`,
      [profileId, normalised],
    )
    return true
  }

  async function unfollowHashtag(profileId: string, tag: string) {
    const normalised = normaliseHashtag(tag)
    if (!isStorableHashtag(normalised)) return false
    await queryRows(
      `delete from public.hashtag_follows hf
       using public.hashtags h
       where h.id = hf.hashtag_id and hf.profile_id = $1 and h.tag = $2`,
      [profileId, normalised],
    )
    return true
  }

  async function isFollowingHashtag(profileId: string, tag: string) {
    const normalised = normaliseHashtag(tag)
    if (!isStorableHashtag(normalised)) return false
    const rows = await queryRows(
      `select exists (
         select 1 from public.hashtag_follows hf
         join public.hashtags h on h.id = hf.hashtag_id
         where hf.profile_id = $1 and h.tag = $2
       ) as following`,
      [profileId, normalised],
    ) as Array<QueryResultRow & { following: boolean | null }>
    return Boolean(rows[0]?.following)
  }

  return { searchHashtags, getHashtagSummary, followHashtag, unfollowHashtag, isFollowingHashtag }
}

export type HashtagRepository = ReturnType<typeof createHashtagRepository>

export const hashtagRepository = createHashtagRepository()

import { query as databaseQuery } from '@/lib/db/client'
import type { FeedMode } from './types'

/**
 * Round G: the member's feed choice (Top for you or Recent), kept on the server so it follows them
 * across devices, and their visits for Recent's "New since your last visit" divider.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

/** A gap this long between two Recent loads starts a new visit. */
export const FEED_VISIT_GAP_MINUTES = 30

export type FeedPreference = {
  mode: FeedMode | null
  lastVisitAt: Date | null
  previousVisitAt: Date | null
}

function date(value: unknown) {
  if (!value) return null
  return value instanceof Date ? value : new Date(String(value))
}

export function createFeedPreferences(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))

  async function get(profileId: string): Promise<FeedPreference> {
    const rows = await queryRows(
      `select feed_mode, feed_last_visit_at, feed_previous_visit_at from public.member_preferences where profile_id = $1`,
      [profileId],
    )
    const row = rows[0]
    const mode = row?.feed_mode === 'top' || row?.feed_mode === 'recent' ? row.feed_mode : null
    return { mode, lastVisitAt: date(row?.feed_last_visit_at), previousVisitAt: date(row?.feed_previous_visit_at) }
  }

  async function setMode(profileId: string, mode: FeedMode) {
    await queryRows(
      `insert into public.member_preferences (profile_id, feed_mode, updated_at) values ($1, $2, now())
       on conflict (profile_id) do update set feed_mode = excluded.feed_mode, updated_at = now()`,
      [profileId, mode],
    )
  }

  /**
   * Records a Recent visit and returns the time of the one before it (the divider). Loads less than
   * 30 minutes apart count as the same visit, so paging and refreshing keep the divider in place.
   */
  async function touchVisit(profileId: string): Promise<Date | null> {
    const rows = await queryRows(
      `insert into public.member_preferences (profile_id, feed_last_visit_at, updated_at) values ($1, now(), now())
       on conflict (profile_id) do update set
         feed_previous_visit_at = case
           when public.member_preferences.feed_last_visit_at is null
             or public.member_preferences.feed_last_visit_at < now() - make_interval(mins => $2)
           then public.member_preferences.feed_last_visit_at
           else public.member_preferences.feed_previous_visit_at end,
         feed_last_visit_at = now(),
         updated_at = now()
       returning feed_previous_visit_at`,
      [profileId, FEED_VISIT_GAP_MINUTES],
    )
    return date(rows[0]?.feed_previous_visit_at)
  }

  return { get, setMode, touchVisit }
}

export const feedPreferences = createFeedPreferences()

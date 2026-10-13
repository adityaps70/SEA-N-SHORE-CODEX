import { query as databaseQuery } from '@/lib/db/client'
import { normaliseSearchQuery } from './search-weights'

/**
 * Round G (G4): committed searches (Enter, "See all results", or opening a result; never each
 * keystroke) in public.search_queries, kept 90 days. They give the member their recent searches
 * (with Clear all) and the admin "Searches with no results" list, which shows the query text and
 * a count only, never who searched.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export const RECENT_SEARCHES_SHOWN = 8

export function createSearchLog(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values) as Promise<Array<Record<string, unknown>>>)

  async function record(viewerId: string, raw: string, entry: { vertical?: string; resultCount: number; clickedKind?: string | null }) {
    const normalized = normaliseSearchQuery(raw)
    if (!normalized) return
    await queryRows(
      `insert into public.search_queries (viewer_id, normalized_query, vertical, result_count, clicked_kind)
       values ($1, $2, $3, $4, $5)`,
      [viewerId, normalized, entry.vertical ?? 'all', Math.max(0, Math.trunc(entry.resultCount)), entry.clickedKind ?? null],
    )
  }

  async function recent(viewerId: string, limit = RECENT_SEARCHES_SHOWN): Promise<string[]> {
    const rows = await queryRows(
      `select normalized_query, max(created_at) as last_at
       from public.search_queries
       where viewer_id = $1 and cleared_at is null and created_at > now() - interval '90 days'
       group by normalized_query
       order by last_at desc
       limit $2`,
      [viewerId, limit],
    )
    return rows.map((row) => String(row.normalized_query))
  }

  /** "Clear all": the rows stay for the no-results report (no viewer link is shown there) but leave the list. */
  async function clear(viewerId: string) {
    await queryRows(`update public.search_queries set cleared_at = now() where viewer_id = $1 and cleared_at is null`, [viewerId])
  }

  /** Admin: committed searches that found nothing in the last 30 days, most frequent first. */
  async function noResults(limit = 100): Promise<Array<{ query: string; count: number }>> {
    const rows = await queryRows(
      `select normalized_query, count(*)::int as searches
       from public.search_queries
       where result_count = 0 and created_at > now() - interval '30 days'
       group by normalized_query
       order by searches desc, normalized_query
       limit $1`,
      [limit],
    )
    return rows.map((row) => ({ query: String(row.normalized_query), count: Number(row.searches) }))
  }

  return { record, recent, clear, noResults }
}

export const searchLog = createSearchLog()

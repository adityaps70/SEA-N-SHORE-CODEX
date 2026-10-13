import { query as databaseQuery } from '@/lib/db/client'

/**
 * Round G (MEASURE): the numbers behind Admin › Ranking health, for the last 7 and 28 days.
 * Totals only (ranking_metrics_daily and table counts); never a member, a name or an id.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export const HEALTH_WINDOWS = [7, 28] as const
export type HealthWindow = (typeof HEALTH_WINDOWS)[number]

export type RankingHealth = Record<HealthWindow, {
  metrics: Record<string, number>
  /** Distinct (member, post) pairs first shown in the window. */
  postsSeen: number
  /** Of those, the ones the member reacted to or commented on after it was shown. */
  seenThenReacted: number
  seenThenCommented: number
  searches: number
  zeroResultSearches: number
}>

export function createRankingHealth(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values) as Promise<Array<Record<string, unknown>>>)

  async function window(days: HealthWindow) {
    const [metricRows, activity, searches] = await Promise.all([
      queryRows(
        `select metric, sum(value)::bigint as total from public.ranking_metrics_daily
         where day > current_date - $1::int group by metric`,
        [days],
      ),
      queryRows(
        // Engagement on what the feed showed: a reaction or comment by the member who was shown the
        // post, after it was shown. Site-wide totals would compare unrelated numbers.
        `select count(*)::bigint as seen,
                count(*) filter (where exists (
                  select 1 from public.post_reactions r
                  where r.post_id = i.post_id and r.user_id = i.viewer_id and r.created_at >= i.first_seen_at
                ))::bigint as reacted,
                count(*) filter (where exists (
                  select 1 from public.post_comments c
                  where c.post_id = i.post_id and c.author_id = i.viewer_id and c.deleted_at is null and c.created_at >= i.first_seen_at
                ))::bigint as commented
         from public.post_impressions i
         where i.first_seen_at > now() - make_interval(days => $1::int)`,
        [days],
      ),
      queryRows(
        `select count(*)::bigint as searches, count(*) filter (where result_count = 0)::bigint as zero
         from public.search_queries where created_at > now() - make_interval(days => $1::int)`,
        [days],
      ).catch(() => [{ searches: 0, zero: 0 }]),
    ])
    return {
      metrics: Object.fromEntries(metricRows.map((row) => [String(row.metric), Number(row.total)])),
      postsSeen: Number(activity[0]?.seen ?? 0),
      seenThenReacted: Number(activity[0]?.reacted ?? 0),
      seenThenCommented: Number(activity[0]?.commented ?? 0),
      searches: Number(searches[0]?.searches ?? 0),
      zeroResultSearches: Number(searches[0]?.zero ?? 0),
    }
  }

  async function load(): Promise<RankingHealth> {
    const [week, month] = await Promise.all([window(7), window(28)])
    return { 7: week, 28: month }
  }

  return { load }
}

/** "12.5" per 100, or "–" when there is nothing to divide by. */
export function per100(numerator: number, denominator: number) {
  return denominator > 0 ? ((numerator / denominator) * 100).toFixed(1) : '–'
}

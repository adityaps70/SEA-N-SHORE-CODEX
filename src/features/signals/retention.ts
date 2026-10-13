import { query as databaseQuery } from '@/lib/db/client'

/**
 * Round G (G0.2): retention for the ranking signals, run hourly by the outbox worker. Bounded
 * batches, so one pass never does unbounded work; a backlog clears over a few passes.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export const SIGNAL_RETENTION = {
  /** Matches the longest feed window, so an old seen post can never come back. */
  postImpressions: '180 days',
  searchQueries: '90 days',
  suggestionDismissals: '180 days',
  feedFeedback: '180 days',
  /** Snapshots live 15 minutes; keep an hour for the "served but not seen" demotion on reload. */
  feedSessions: '1 hour',
  rankingMetrics: '400 days',
} as const

export const SIGNAL_RETENTION_BATCH = 5000

const DELETES = [
  ['post_impressions', `delete from public.post_impressions where ctid in (select ctid from public.post_impressions where last_seen_at < now() - $1::interval limit $2) returning 1`, SIGNAL_RETENTION.postImpressions],
  ['search_queries', `delete from public.search_queries where id in (select id from public.search_queries where created_at < now() - $1::interval limit $2) returning 1`, SIGNAL_RETENTION.searchQueries],
  ['suggestion_dismissals', `delete from public.suggestion_dismissals where ctid in (select ctid from public.suggestion_dismissals where created_at < now() - $1::interval limit $2) returning 1`, SIGNAL_RETENTION.suggestionDismissals],
  ['feed_feedback', `delete from public.feed_feedback where ctid in (select ctid from public.feed_feedback where created_at < now() - $1::interval limit $2) returning 1`, SIGNAL_RETENTION.feedFeedback],
  ['feed_sessions', `delete from public.feed_sessions where id in (select id from public.feed_sessions where expires_at < now() - $1::interval limit $2) returning 1`, SIGNAL_RETENTION.feedSessions],
  ['ranking_metrics_daily', `delete from public.ranking_metrics_daily where ctid in (select ctid from public.ranking_metrics_daily where day < (now() - $1::interval)::date limit $2) returning 1`, SIGNAL_RETENTION.rankingMetrics],
] as const

export async function purgeExpiredSignals(input: { query?: Query; batch?: number } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  const batch = input.batch ?? SIGNAL_RETENTION_BATCH
  const purged: Record<string, number> = {}
  for (const [name, sql, interval] of DELETES) {
    const rows = await queryRows(sql, [interval, batch])
    purged[name] = rows.length
  }
  return purged
}

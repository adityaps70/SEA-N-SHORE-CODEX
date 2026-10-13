import { randomUUID } from 'node:crypto'
import { query as databaseQuery } from '@/lib/db/client'
import { FEED_WEIGHTS } from './feed-weights'

/**
 * Round G (G1): one ranked snapshot per visit in Postgres (no Redis). A cursor is a position in
 * it; the snapshot lives 15 minutes. A reload starts a new visit, which never reuses the old order.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export type FeedSessionStage = 'ranked' | 'wider' | 'explore' | 'caught_up'

export type FeedSessionEntryMeta = {
  reasons: string[]
  repostedBy: { actorName: string; others: number } | null
  debug?: { score: number; parts: Record<string, number> }
}

export type FeedSessionMeta = {
  version: string
  coldStart: boolean
  entries: Record<string, FeedSessionEntryMeta>
}

export type FeedSession = {
  id: string
  viewerId: string
  visitId: string
  postIds: string[]
  meta: FeedSessionMeta
  servedCount: number
  stage: FeedSessionStage
  createdAt: Date
  expiresAt: Date
}

function mapSession(row: Record<string, unknown>): FeedSession {
  const meta = (row.meta && typeof row.meta === 'object' ? row.meta : {}) as Partial<FeedSessionMeta>
  return {
    id: String(row.id),
    viewerId: String(row.viewer_id),
    visitId: String(row.visit_id),
    postIds: Array.isArray(row.post_ids) ? row.post_ids.map(String) : [],
    meta: { version: String(meta.version ?? ''), coldStart: Boolean(meta.coldStart), entries: meta.entries ?? {} },
    servedCount: Number(row.served_count ?? 0),
    stage: (row.stage as FeedSessionStage) ?? 'ranked',
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at)),
    expiresAt: row.expires_at instanceof Date ? row.expires_at : new Date(String(row.expires_at)),
  }
}

export function createFeedSessionRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))

  async function create(session: { viewerId: string; visitId: string; postIds: string[]; meta: FeedSessionMeta; stage: FeedSessionStage }) {
    const rows = await queryRows(
      `insert into public.feed_sessions (id, viewer_id, visit_id, post_ids, meta, stage, expires_at)
       values ($1, $2, $3, $4::uuid[], $5::jsonb, $6, now() + make_interval(mins => $7))
       returning *`,
      [randomUUID(), session.viewerId, session.visitId, session.postIds, JSON.stringify(session.meta), session.stage, FEED_WEIGHTS.session.ttlMinutes],
    )
    return mapSession(rows[0]!)
  }

  /** The viewer's own session, even when expired (the caller decides). */
  async function get(viewerId: string, sessionId: string) {
    const rows = await queryRows(`select * from public.feed_sessions where id = $1 and viewer_id = $2`, [sessionId, viewerId])
    return rows[0] ? mapSession(rows[0]) : null
  }

  async function markServed(sessionId: string, servedCount: number) {
    await queryRows(`update public.feed_sessions set served_count = greatest(served_count, $2) where id = $1`, [sessionId, servedCount])
  }

  /** Content ids (originals of reposts) already served in this visit, so a later snapshot never repeats them. */
  async function servedContentIds(viewerId: string, visitId: string) {
    const rows = await queryRows(
      `select distinct coalesce(p.repost_of_post_id, p.id) as id
       from public.feed_sessions s
       cross join lateral unnest(s.post_ids[1:greatest(s.served_count, 0)]) as served(post_id)
       join public.posts p on p.id = served.post_id
       where s.viewer_id = $1 and s.visit_id = $2`,
      [viewerId, visitId],
    )
    return rows.map((row) => String(row.id))
  }

  /** Every content id placed in any snapshot of this visit (served or not), used when building the next one. */
  async function snapshotContentIds(viewerId: string, visitId: string) {
    const rows = await queryRows(
      `select distinct coalesce(p.repost_of_post_id, p.id) as id
       from public.feed_sessions s
       cross join lateral unnest(s.post_ids) as listed(post_id)
       join public.posts p on p.id = listed.post_id
       where s.viewer_id = $1 and s.visit_id = $2`,
      [viewerId, visitId],
    )
    return rows.map((row) => String(row.id))
  }

  /**
   * Served in the viewer's previous visit (last hour) but never counted as seen: on reload these can
   * come back, but lower down and never in the same order at the top.
   */
  async function servedNotSeenContentIds(viewerId: string, currentVisitId: string) {
    const rows = await queryRows(
      `select distinct coalesce(p.repost_of_post_id, p.id) as id
       from public.feed_sessions s
       cross join lateral unnest(s.post_ids[1:greatest(s.served_count, 0)]) as served(post_id)
       join public.posts p on p.id = served.post_id
       where s.viewer_id = $1 and s.visit_id <> $2 and s.created_at > now() - interval '1 hour'
         and not exists (select 1 from public.post_impressions i where i.viewer_id = $1 and i.post_id = p.id)`,
      [viewerId, currentVisitId],
    )
    return rows.map((row) => String(row.id))
  }

  return { create, get, markServed, servedContentIds, snapshotContentIds, servedNotSeenContentIds }
}

export const feedSessionRepository = createFeedSessionRepository()

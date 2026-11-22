import { isLoadTestProfileSql } from '@/features/load-test/load-test-sql'
import { query as databaseQuery } from '@/lib/db/client'
import { createMetricBatch, type MetricIncrement } from './metric-batch'

/**
 * Round G (G0.2): the signals the rankings learn from. Privacy-light: ids and times only, no IP, no
 * user agent. Retention runs in the outbox worker (signals/retention.ts).
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export const SUGGESTION_KINDS = ['person', 'org', 'community', 'event', 'course', 'job'] as const
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number]

export const FEED_FEEDBACK_KINDS = ['show_less', 'not_relevant'] as const
export type FeedFeedbackKind = (typeof FEED_FEEDBACK_KINDS)[number]

/** One upsert per viewer and post per hour at most; a refresh inside the hour changes nothing. */
export const IMPRESSION_RECOUNT_INTERVAL = '1 hour'
/** Most post ids one impressions request may carry. */
export const MAX_IMPRESSIONS_PER_REQUEST = 50

export function isSuggestionKind(value: unknown): value is SuggestionKind {
  return (SUGGESTION_KINDS as readonly unknown[]).includes(value)
}

export function createSignalsRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))

  /**
   * Records that the viewer saw these posts (≥50% visible for ≥1 s, reported by the client).
   * Unknown ids are skipped. Returns how many rows were written.
   */
  async function recordImpressions(viewerId: string, postIds: readonly string[]) {
    const ids = [...new Set(postIds)].slice(0, MAX_IMPRESSIONS_PER_REQUEST)
    if (!ids.length) return 0
    const rows = await queryRows(
      `with written as (
         insert into public.post_impressions as i (viewer_id, post_id)
         select $1, p.id
         from public.posts p
         where p.id = any($2::uuid[])
           and not ${isLoadTestProfileSql('$1::uuid')}
         on conflict (viewer_id, post_id) do update
           set seen_count = i.seen_count + 1, last_seen_at = now()
           where i.last_seen_at < now() - $3::interval
         returning 1
       )
       select count(*)::int as written from written`,
      [viewerId, ids, IMPRESSION_RECOUNT_INTERVAL],
    )
    return Number(rows[0]?.written ?? 0)
  }

  async function dismissSuggestion(viewerId: string, kind: SuggestionKind, targetId: string) {
    await queryRows(
      `insert into public.suggestion_dismissals (viewer_id, kind, target_id)
       values ($1, $2, $3)
       on conflict (viewer_id, kind, target_id) do update set created_at = now()`,
      [viewerId, kind, targetId],
    )
    if (kind === 'person') {
      await queryRows(`delete from public.people_suggestions where viewer_id = $1 and candidate_id = $2`, [viewerId, targetId])
    }
  }

  /** "Undo" right after a dismissal. */
  async function undoDismissSuggestion(viewerId: string, kind: SuggestionKind, targetId: string) {
    await queryRows(
      `delete from public.suggestion_dismissals where viewer_id = $1 and kind = $2 and target_id = $3`,
      [viewerId, kind, targetId],
    )
  }

  async function muteProfile(viewerId: string, profileId: string) {
    await queryRows(
      `insert into public.user_mutes (viewer_id, muted_profile_id)
       select $1, p.id from public.profiles p where p.id = $2 and p.id <> $1
       on conflict (viewer_id, muted_profile_id) where muted_profile_id is not null do nothing`,
      [viewerId, profileId],
    )
  }

  async function muteOrganization(viewerId: string, companyId: string) {
    await queryRows(
      `insert into public.user_mutes (viewer_id, muted_org_id)
       select $1, c.id from public.companies c where c.id = $2
       on conflict (viewer_id, muted_org_id) where muted_org_id is not null do nothing`,
      [viewerId, companyId],
    )
  }

  async function unmute(viewerId: string, muteId: string) {
    const rows = await queryRows(
      `delete from public.user_mutes where id = $1 and viewer_id = $2 returning id`,
      [muteId, viewerId],
    )
    return rows.length > 0
  }

  /** Undo right after "Mute": by the muted member or organization rather than the row id. */
  async function unmuteTarget(viewerId: string, target: { profileId?: string; companyId?: string }) {
    const rows = await queryRows(
      `delete from public.user_mutes
       where viewer_id = $1 and (muted_profile_id = $2::uuid or muted_org_id = $3::uuid)
       returning id`,
      [viewerId, target.profileId ?? null, target.companyId ?? null],
    )
    return rows.length > 0
  }

  async function listMutes(viewerId: string) {
    const rows = await queryRows(
      `select m.id, m.created_at,
              case when m.muted_profile_id is not null then 'person' else 'org' end as kind,
              coalesce(p.full_name, c.name) as name,
              coalesce(p.slug, c.slug) as slug,
              coalesce(p.headline, c.tagline) as subtitle
       from public.user_mutes m
       left join public.profiles p on p.id = m.muted_profile_id
       left join public.companies c on c.id = m.muted_org_id
       where m.viewer_id = $1
       order by m.created_at desc`,
      [viewerId],
    )
    return rows.map((row) => ({
      id: String(row.id),
      kind: row.kind === 'person' ? 'person' as const : 'org' as const,
      name: String(row.name ?? ''),
      slug: row.slug ? String(row.slug) : null,
      subtitle: row.subtitle ? String(row.subtitle) : null,
      mutedAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    }))
  }

  /** "Show less like this" / "Not relevant": remembers the post's author, organization and category for the penalty. */
  async function recordFeedFeedback(viewerId: string, postId: string, kind: FeedFeedbackKind) {
    const rows = await queryRows(
      `insert into public.feed_feedback (viewer_id, post_id, kind, author_id, company_id, category)
       select $1, p.id, $3, case when p.company_id is null then p.author_id end, p.company_id, p.category::text
       from public.posts p
       where p.id = $2
       on conflict (viewer_id, post_id, kind) do update set created_at = now()
       returning 1`,
      [viewerId, postId, kind],
    )
    return rows.length > 0
  }

  /**
   * Adds `amount` to today's total for an admin health metric (counts only, no member ids). When the action's member
   * is given and is a load-test account (Round ARCH), nothing is counted.
   */
  async function incrementMetric(metric: string, amount = 1, actorProfileId: string | null = null) {
    if (amount <= 0) return
    await queryRows(
      `insert into public.ranking_metrics_daily (day, metric, value)
       select (now() at time zone 'utc')::date, $1, $2
       where $3::uuid is null or not ${isLoadTestProfileSql('$3::uuid')}
       on conflict (day, metric) do update set value = public.ranking_metrics_daily.value + excluded.value`,
      [metric, amount, actorProfileId],
    )
  }

  /** Owner (18 Nov, fix 3d): many increments in one statement, load-test accounts left out exactly as above. */
  async function incrementMetrics(increments: readonly MetricIncrement[]) {
    const kept = increments.filter((increment) => increment.amount > 0)
    if (kept.length === 0) return
    await queryRows(
      `insert into public.ranking_metrics_daily (day, metric, value)
       select (now() at time zone 'utc')::date, t.metric, sum(t.amount)::int
       from unnest($1::text[], $2::int[], $3::uuid[]) as t(metric, amount, actor)
       where t.actor is null or not ${isLoadTestProfileSql('t.actor')}
       group by t.metric
       on conflict (day, metric) do update set value = public.ranking_metrics_daily.value + excluded.value`,
      [kept.map((i) => i.metric), kept.map((i) => i.amount), kept.map((i) => i.actorProfileId)],
    )
  }

  return {
    incrementMetrics,
    recordImpressions,
    dismissSuggestion,
    undoDismissSuggestion,
    muteProfile,
    muteOrganization,
    unmute,
    unmuteTarget,
    listMutes,
    recordFeedFeedback,
    incrementMetric,
  }
}

export const signalsRepository = createSignalsRepository()

const rankingMetricBatch = createMetricBatch({ write: (increments) => signalsRepository.incrementMetrics(increments) })

/**
 * Metrics are best effort: a failure is logged without ids and never breaks the request. Owner (18 Nov, fix 3d): summed
 * in memory and written once a minute per server (metric-batch.ts).
 */
export async function incrementRankingMetric(metric: string, amount = 1, actorProfileId: string | null = null) {
  rankingMetricBatch.add(metric, amount, actorProfileId)
}

/** Writes the held increments now (tests, and a server that is about to stop). */
export function flushRankingMetrics() {
  return rankingMetricBatch.flush()
}

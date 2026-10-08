import type { DatabaseQueryClient } from '@/lib/db/client'

/**
 * Round 14 (2.8): per-member quotas for social actions, enforced on the server inside the same
 * transaction as the action itself. Every counted action leaves one row in
 * public.social_action_events (migration 0064). A member's actions of one kind are serialized with
 * a transaction-scoped advisory lock, so two quick requests cannot both slip under the limit.
 */
export type SocialAction = 'connection_request' | 'post' | 'comment' | 'reaction'

type SocialActionQuota = {
  /** Most actions allowed inside the rolling window. */
  limit: number
  /** Rolling window, as a Postgres interval. */
  window: string
  /** Error code thrown when the limit is reached. */
  code: string
}

export const SOCIAL_ACTION_QUOTAS: Readonly<Record<SocialAction, SocialActionQuota>> = {
  connection_request: { limit: 50, window: '24 hours', code: 'network_connection_request_limit' },
  post: { limit: 20, window: '1 hour', code: 'feed_post_rate_limited' },
  comment: { limit: 120, window: '1 hour', code: 'feed_comment_rate_limited' },
  reaction: { limit: 300, window: '1 hour', code: 'feed_reaction_rate_limited' },
}

/** A member may ask the same member again only this long after their previous request. */
export const CONNECTION_REQUEST_COOLDOWN = '7 days'
export const CONNECTION_REQUEST_COOLDOWN_CODE = 'network_connection_request_cooldown'

/** Rows older than this are no longer needed by any window and are pruned as members act. */
export const SOCIAL_ACTION_EVENT_RETENTION = '8 days'
/** Upper bound on rows pruned per action, so one request never does unbounded work. */
export const SOCIAL_ACTION_PRUNE_BATCH = 50

export type SocialQuotaQuery = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export type SocialActionQuotaInput = {
  profileId: string
  action: SocialAction
  /** The member a connection request is sent to; enables the re-request cooldown. */
  targetProfileId?: string | null
}

type QuotaWarning = (tag: string, context: Record<string, string>) => void

const defaultWarn: QuotaWarning = (tag, context) => console.warn(tag, context)

/**
 * Checks and records one social action. Must run inside the action's transaction (the advisory
 * lock is held until commit and the event row rolls back with a failed action).
 *
 * Throws the action's quota code when the member is over the limit, or
 * `network_connection_request_cooldown` when they asked the same member within the last 7 days and
 * that request is gone (declined or withdrawn). Callers check for a pending or accepted connection
 * first, so the cooldown only ever applies when no connection row exists for the pair.
 *
 * Fails open only when the events table does not exist yet (Postgres "relation does not exist",
 * 42P01: migration 0064 not applied). The table is looked up with to_regclass in the same
 * statement as the lock, so a missing table is detected without raising 42P01, which would abort
 * the caller's whole transaction. Every query error propagates unchanged.
 */
export async function consumeSocialActionQuota(
  query: SocialQuotaQuery,
  input: SocialActionQuotaInput,
  options: { warn?: QuotaWarning } = {},
): Promise<{ counted: boolean }> {
  const quota = SOCIAL_ACTION_QUOTAS[input.action]
  const warn = options.warn ?? defaultWarn
  const targetProfileId = input.action === 'connection_request' ? input.targetProfileId ?? null : null

  const [lock] = await query(
    `select pg_advisory_xact_lock(hashtext('social_quota:' || $1::text || ':' || $2::text)) as locked,
            to_regclass('public.social_action_events') is not null as ready`,
    [input.profileId, input.action],
  )
  if (lock?.ready !== true) {
    warn('[social_action_quota_skipped]', { action: input.action, reason: 'events_table_missing' })
    return { counted: false }
  }

  const [usage] = await query(
    `select
       (select count(*)
          from (
            select 1
            from public.social_action_events e
            where e.profile_id = $1
              and e.action = $2
              and e.created_at > now() - $3::interval
            order by e.created_at desc
            limit $4
          ) recent)::int as recent_total,
       ($5::uuid is not null and exists (
          select 1
          from public.social_action_events e
          where e.profile_id = $1
            and e.action = 'connection_request'
            and e.target_profile_id = $5::uuid
            and e.created_at > now() - $6::interval
        )) as cooling_down`,
    [input.profileId, input.action, quota.window, quota.limit, targetProfileId, CONNECTION_REQUEST_COOLDOWN],
  )
  if (usage?.cooling_down === true) throw new Error(CONNECTION_REQUEST_COOLDOWN_CODE)
  if (Number(usage?.recent_total ?? 0) >= quota.limit) throw new Error(quota.code)

  await query(
    `with pruned as (
       delete from public.social_action_events
       where id in (
         select e.id
         from public.social_action_events e
         where e.profile_id = $1
           and e.action = $2
           and e.created_at < now() - $4::interval
         order by e.created_at
         limit $5
       )
     )
     insert into public.social_action_events (profile_id, action, target_profile_id)
     values ($1, $2, $3::uuid)`,
    [input.profileId, input.action, targetProfileId, SOCIAL_ACTION_EVENT_RETENTION, SOCIAL_ACTION_PRUNE_BATCH],
  )
  return { counted: true }
}

export type SocialActionQuotas = {
  consume(input: SocialActionQuotaInput): Promise<{ counted: boolean }>
}

/** Quotas bound to one transaction's client. */
export function createSocialActionQuotasForClient(client: DatabaseQueryClient): SocialActionQuotas {
  const query: SocialQuotaQuery = async (text, values) => (await client.query(text, values)).rows
  return {
    consume: (input) => consumeSocialActionQuota(query, input),
  }
}

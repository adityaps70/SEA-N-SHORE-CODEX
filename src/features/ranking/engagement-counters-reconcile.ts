import { query as databaseQuery } from '@/lib/db/client'

/**
 * Round CAP (feed counters, owner-approved 13 Nov): the triggers of migration 0102 keep the reaction, comment-reaction
 * and poll-vote counters on write. Once a night this recounts every counter from the rows themselves, in batches that
 * stay well under the app role's 10-second statement limit, and corrects any that drifted. It logs how many it
 * scanned and fixed (counts only). A write landing while a batch is recounted can leave one counter off by one until
 * the next night; the reads clamp at zero.
 */
export const COUNTER_RECONCILE_START_UTC = { hour: 21, minute: 15 }
export const COUNTER_RECONCILE_BATCH = 500
export const COUNTER_RECONCILE_PASS_MS = 15_000

const REACTION_TRUTH = `count(r.reaction_type) filter (where r.reaction_type = 'like')::int as like_count,
       count(r.reaction_type) filter (where r.reaction_type = 'support')::int as support_count,
       count(r.reaction_type) filter (where r.reaction_type = 'respect')::int as respect_count,
       count(r.reaction_type) filter (where r.reaction_type = 'on_point')::int as on_point_count`
const REACTION_COLUMNS = ['like_count', 'support_count', 'respect_count', 'on_point_count']

/** One batch: ids after $1 (or from the start), $2 at most; recount, write only what differs. */
function reconcileSql(input: { source: string; counters: string; key: string; truth: string; join: string; columns: string[] }) {
  const cols = input.columns
  const differs = cols.map((col) => `c.${col} is distinct from t.${col}`).join(' or ')
  const anyNonZero = cols.map((col) => `t.${col} > 0`).join(' or ')
  return `
    with batch as (
      select id from ${input.source} where ($1::uuid is null or id > $1::uuid) order by id limit $2
    ),
    truth as (
      select b.id as ${input.key}, ${input.truth}
      from batch b ${input.join}
      group by b.id
    ),
    wrong as (
      select t.* from truth t
      left join ${input.counters} c on c.${input.key} = t.${input.key}
      where (c.${input.key} is null and (${anyNonZero})) or (c.${input.key} is not null and (${differs}))
    ),
    fixed as (
      insert into ${input.counters} as c (${input.key}, ${cols.join(', ')}, updated_at)
      select ${input.key}, ${cols.join(', ')}, now() from wrong
      on conflict (${input.key}) do update set ${cols.map((col) => `${col} = excluded.${col}`).join(', ')}, updated_at = now()
      returning 1
    )
    select (select id from batch order by id desc limit 1) as last_id,
           (select count(*) from batch)::int as scanned,
           (select count(*) from fixed)::int as fixed`
}

export const COUNTER_RECONCILE_STEPS = [
  {
    name: 'post_reactions',
    sql: reconcileSql({
      source: 'public.posts', counters: 'public.post_reaction_counts', key: 'post_id', truth: REACTION_TRUTH,
      join: 'left join public.post_reactions r on r.post_id = b.id', columns: REACTION_COLUMNS,
    }),
  },
  {
    name: 'comment_reactions',
    sql: reconcileSql({
      source: 'public.post_comments', counters: 'public.comment_reaction_counts', key: 'comment_id', truth: REACTION_TRUTH,
      join: 'left join public.comment_reactions r on r.comment_id = b.id', columns: REACTION_COLUMNS,
    }),
  },
  {
    name: 'poll_votes',
    sql: reconcileSql({
      source: 'public.post_poll_options', counters: 'public.post_poll_option_counts', key: 'option_id',
      truth: 'count(v.option_id)::int as votes', join: 'left join public.post_poll_votes v on v.option_id = b.id', columns: ['votes'],
    }),
  },
] as const

export function nextReconcileStart(after: Date) {
  const next = new Date(Date.UTC(after.getUTCFullYear(), after.getUTCMonth(), after.getUTCDate(), COUNTER_RECONCILE_START_UTC.hour, COUNTER_RECONCILE_START_UTC.minute))
  if (next.getTime() <= after.getTime()) next.setUTCDate(next.getUTCDate() + 1)
  return next.getTime()
}

type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export function createCounterReconcileSweep(input: { query?: Query; now?: () => number; batchSize?: number } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  const now = input.now ?? Date.now
  const batchSize = input.batchSize ?? COUNTER_RECONCILE_BATCH
  let nextRunAt: number | null = null
  let step = 0
  let cursor: string | null = null
  let totals: Record<string, { scanned: number; fixed: number }> = {}
  let running = false

  return {
    name: 'engagement_counter_reconcile',
    everyMs: COUNTER_RECONCILE_PASS_MS,
    requiresTable: 'post_reaction_counts',
    /** One batch per pass during the nightly run; a summary once all three counters are done. */
    async run() {
      const current = now()
      if (nextRunAt === null) nextRunAt = nextReconcileStart(new Date(current))
      if (!running) {
        if (current < nextRunAt) return undefined
        running = true
        step = 0
        cursor = null
        totals = {}
      }
      const target = COUNTER_RECONCILE_STEPS[step]!
      const row = (await queryRows(target.sql, [cursor, batchSize]))[0] ?? {}
      const scanned = Number(row.scanned ?? 0)
      const entry = totals[target.name] ?? (totals[target.name] = { scanned: 0, fixed: 0 })
      entry.scanned += scanned
      entry.fixed += Number(row.fixed ?? 0)
      if (scanned < batchSize) {
        step += 1
        cursor = null
      } else {
        cursor = String(row.last_id)
      }
      if (step < COUNTER_RECONCILE_STEPS.length) return undefined
      running = false
      nextRunAt = nextReconcileStart(new Date(current))
      return totals
    },
  }
}

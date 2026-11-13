import { query as databaseQuery } from '@/lib/db/client'

/**
 * Round CAP (finding 8, owner-approved 13 Nov): how many signed-in members are online at once, measured directly.
 * Once a minute the worker counts members whose device session was seen in the last 5 minutes (load-test accounts
 * left out) and keeps the highest count of each UTC hour in ranking_metrics_daily as `online.peak_utc_hHH`. A
 * session's last_seen_at moves at most every 5 minutes, so the count can miss a member between two moves: it is a
 * floor. Counts only; never a member, a name or an id.
 */
export const ONLINE_PEAK_SWEEP_MS = 60_000
export const ONLINE_WINDOW_MINUTES = 5

export const ONLINE_PEAK_SQL = `
  with online as (
    select count(distinct s.profile_id)::bigint as members
    from public.auth_sessions s
    join public.profiles p on p.id = s.profile_id
    where s.revoked_at is null
      and s.last_seen_at > now() - make_interval(mins => $1::int)
      and not p.is_load_test
  )
  insert into public.ranking_metrics_daily (day, metric, value)
  select (now() at time zone 'UTC')::date, 'online.peak_utc_h' || to_char(now() at time zone 'UTC', 'HH24'), members
  from online
  on conflict (day, metric) do update set value = greatest(public.ranking_metrics_daily.value, excluded.value)
  returning value
`

type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export function createOnlinePeakSweep(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  return {
    name: 'online_peak',
    everyMs: ONLINE_PEAK_SWEEP_MS,
    requiresTable: 'auth_sessions',
    async run() {
      await queryRows(ONLINE_PEAK_SQL, [ONLINE_WINDOW_MINUTES])
      // Nothing to log each minute; the hourly peaks are in ranking_metrics_daily.
      return undefined
    },
  }
}

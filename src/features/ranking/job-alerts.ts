import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { jobsRepository, type JobsRepository } from '@/features/jobs/repository'
import { parseJobSearchParams, rankFilterKeys } from '@/features/jobs/search'
import type { JobListing, JobSearchFilters } from '@/features/jobs/types'
import { jobMatchDisplay } from '@/features/jobs/match-display'
import { scoreJobForMember } from './job-match'
import { isJobClosed } from './job-scorer'
import { JOB_WEIGHTS } from './job-weights'
import { rankingSwitches } from './switches'

/**
 * Round G (G3): the job alert sender, run by the outbox worker. Each enabled alert is looked at
 * once per period (daily; weekly on Mondays; the old "instant" choice is treated as daily), from
 * 02:00 UTC (07:30 IST). It sends jobs published since the alert's last email that match the
 * alert's filters AND that the member is eligible for (matching v2), best match first, at most 10.
 * Nothing new means no email. One transaction queues the email, records each job as delivered (so
 * a re-run never sends a job twice), adds the in-app job_alert_match notification and moves the
 * alert's pointers. Members who turned job alert emails off are skipped; behind the job_alerts
 * ranking switch (administrators first).
 */
type Row = Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

const DAY_MS = 86_400_000
const LOOKBACK_DAYS = 14

export type JobAlertEmailJob = { id: string; title: string; companyName: string; location: string | null; label: string }
export type JobAlertEmailPayload = { alertId: string; alertName: string; jobs: JobAlertEmailJob[]; test?: boolean }

type DueAlert = { id: string; userId: string; name: string; filters: unknown; frequency: string; lastSentAt: Date | null; createdAt: Date }

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows as Row[]))
}

/** A stored alert's filters as today's JobSearchFilters (older alerts may hold rank names). */
export function alertFilters(stored: unknown): JobSearchFilters {
  const base = parseJobSearchParams({})
  const value = (stored && typeof stored === 'object' ? stored : {}) as Partial<JobSearchFilters>
  const strings = (input: unknown) => (Array.isArray(input) ? input.filter((item): item is string => typeof item === 'string').slice(0, 20) : [])
  const numberOrNull = (input: unknown) => (typeof input === 'number' && Number.isFinite(input) ? input : null)
  return {
    ...base,
    query: typeof value.query === 'string' ? value.query.slice(0, 120) : '',
    mode: value.mode === 'sea' || value.mode === 'shore' || value.mode === 'urgent' ? value.mode : 'for-you',
    department: typeof value.department === 'string' ? value.department : null,
    ranks: rankFilterKeys(strings(value.ranks)),
    vesselTypes: strings(value.vesselTypes),
    minExperienceYears: numberOrNull(value.minExperienceYears),
    joiningWithinDays: numberOrNull(value.joiningWithinDays),
    salaryMin: numberOrNull(value.salaryMin),
    salaryMax: numberOrNull(value.salaryMax),
    regions: strings(value.regions),
    certificates: strings(value.certificates),
    visas: strings(value.visas),
    verifiedOnly: value.verifiedOnly === true,
    urgentOnly: value.urgentOnly === true || value.mode === 'urgent',
    easyApplyOnly: value.easyApplyOnly === true,
    postedWithinDays: null,
    sort: 'recent',
  }
}

function utcDay(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function createJobAlertSender(input: {
  query?: Query
  transaction?: Transaction
  jobs?: Pick<JobsRepository, 'searchJobs' | 'getCandidateProfile'>
  modeFor?: () => Promise<'off' | 'admins' | 'everyone'>
  now?: () => Date
} = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values) as Promise<Row[]>)
  const transaction = input.transaction ?? runtimeTransaction
  const jobs = input.jobs ?? jobsRepository
  const modeFor = input.modeFor ?? (async () => (await rankingSwitches.listModes()).job_alerts)
  const now = input.now ?? (() => new Date())

  /** Alerts not yet looked at this period, for members the switch covers, who have not turned the emails off. */
  async function dueAlerts(mode: 'admins' | 'everyone', at: Date): Promise<DueAlert[]> {
    const rows = await queryRows(
      `select a.id, a.user_id, a.name, a.filters, a.frequency, a.last_sent_at, a.created_at
       from public.job_alerts a
       join public.profiles p on p.id = a.user_id and p.account_status = 'active' and p.onboarding_completed_at is not null
       where a.enabled = true
         and (
           (a.frequency in ('daily', 'instant') and (a.last_checked_at is null or a.last_checked_at < $1::date))
           or (a.frequency = 'weekly' and extract(dow from $2::timestamptz at time zone 'UTC') = $3
               and (a.last_checked_at is null or a.last_checked_at < $2::timestamptz - interval '6 days'))
         )
         and not exists (
           select 1 from public.member_email_topics t
           where t.profile_id = a.user_id and t.topic = 'job_alerts' and t.email_enabled = false
         )
         and ($4::text = 'everyone' or exists (
           select 1 from public.user_roles r where r.user_id = a.user_id and r.role::text = 'administrator'
         ))
       order by a.last_checked_at asc nulls first, a.id
       limit $5`,
      [utcDay(at), at.toISOString(), JOB_WEIGHTS.alerts.weeklyDay, mode, JOB_WEIGHTS.alerts.batchSize],
    )
    return rows.map((row) => ({
      id: String(row.id),
      userId: String(row.user_id),
      name: String(row.name),
      filters: row.filters,
      frequency: String(row.frequency),
      lastSentAt: row.last_sent_at ? new Date(row.last_sent_at as string) : null,
      createdAt: new Date(row.created_at as string),
    }))
  }

  /** The eligible new jobs for one alert, best match first (at most 10). */
  async function matchesFor(alert: Pick<DueAlert, 'id' | 'userId' | 'filters' | 'lastSentAt' | 'createdAt'>, at: Date, options: { ignoreHistory?: boolean } = {}) {
    const profile = await jobs.getCandidateProfile(alert.userId)
    if (!profile) return []
    const floor = new Date(at.getTime() - LOOKBACK_DAYS * DAY_MS)
    const since = options.ignoreHistory ? floor : new Date(Math.max((alert.lastSentAt ?? alert.createdAt).getTime(), floor.getTime()))
    const filters = { ...alertFilters(alert.filters), postedWithinDays: Math.min(LOOKBACK_DAYS, Math.ceil((at.getTime() - since.getTime()) / DAY_MS) + 1) }
    const found = (await jobs.searchJobs(filters, 100, 0))
      .filter((job) => Date.parse(job.publishedAt ?? job.createdAt) > since.getTime() && !isJobClosed(job, at))
    if (!found.length) return []
    const delivered = options.ignoreHistory ? new Set<string>() : new Set((await queryRows(
      `select job_id from public.job_alert_deliveries where alert_id = $1 and job_id = any($2::uuid[])`,
      [alert.id, found.map((job) => job.id)],
    )).map((row) => String(row.job_id)))
    return found
      .filter((job) => !delivered.has(job.id))
      .map((job) => ({ job, match: scoreJobForMember(job, profile, at).match }))
      .filter(({ match }) => match.eligible && !match.seaJobForOtherProfileType && match.score !== null)
      .sort((left, right) => (right.match.score ?? 0) - (left.match.score ?? 0) || Date.parse(right.job.publishedAt ?? right.job.createdAt) - Date.parse(left.job.publishedAt ?? left.job.createdAt))
      .slice(0, JOB_WEIGHTS.alerts.maxJobsPerEmail)
  }

  function emailJob(job: JobListing, label: string): JobAlertEmailJob {
    return { id: job.id, title: job.title, companyName: job.companyName, location: job.location, label }
  }

  /** Queues one alert's email; returns 'sent' | 'empty' | 'duplicate'. */
  async function processAlert(alert: DueAlert, at: Date) {
    const matches = await matchesFor(alert, at)
    if (!matches.length) {
      await queryRows(`update public.job_alerts set last_checked_at = $2 where id = $1`, [alert.id, at.toISOString()])
      return 'empty' as const
    }
    const payload: JobAlertEmailPayload = {
      alertId: alert.id,
      alertName: alert.name,
      jobs: matches.map(({ job, match }) => emailJob(job, jobMatchDisplay(match)?.label ?? 'Match')),
    }
    const dedupe = `job_alert/${alert.id}/${utcDay(at)}`
    return transaction(async (query) => {
      const queued = await query(
        `insert into public.ranking_emails (dedupe_key, recipient_id, topic, payload)
         values ($1, $2, 'job_alerts', $3::jsonb)
         on conflict (dedupe_key) do nothing
         returning id`,
        [dedupe, alert.userId, JSON.stringify(payload)],
      )
      if (queued.length) {
        await query(
          `insert into public.job_alert_deliveries (alert_id, job_id)
           select $1, job_id from unnest($2::uuid[]) as job_id
           on conflict do nothing`,
          [alert.id, matches.map(({ job }) => job.id)],
        )
        await query(
          `insert into public.notifications (recipient_id, actor_id, notification_type, details, dedupe_key)
           values ($1, null, 'job_alert_match'::public.network_notification_type, $2::jsonb, $3)
           on conflict (recipient_id, dedupe_key) where dedupe_key is not null do nothing`,
          [alert.userId, JSON.stringify({ alertName: alert.name, count: matches.length, jobId: matches[0]!.job.id, jobTitle: matches[0]!.job.title }), dedupe],
        )
      }
      await query(
        `update public.job_alerts set last_checked_at = $2${queued.length ? ', last_sent_at = $2' : ''} where id = $1`,
        [alert.id, at.toISOString()],
      )
      return queued.length ? 'sent' as const : 'duplicate' as const
    })
  }

  /** One pass of the sweep: up to one batch of due alerts. */
  async function run() {
    const at = now()
    if (at.getUTCHours() < JOB_WEIGHTS.alerts.sendHourUtc) return { waiting: true }
    const mode = await modeFor()
    if (mode === 'off') return { off: true }
    const alerts = await dueAlerts(mode, at)
    const counts = { alerts: alerts.length, queued: 0, empty: 0, duplicate: 0, failed: 0 }
    for (const alert of alerts) {
      try {
        const result = await processAlert(alert, at)
        if (result === 'sent') counts.queued += 1
        else counts[result] += 1
      } catch (error) {
        counts.failed += 1
        console.warn('[job_alert_failed]', { code: (error as { code?: string })?.code ?? null })
      }
    }
    return counts
  }

  /**
   * Admin › Ranking "Send me a test job alert": the administrator's first alert (or Jobs for you
   * when they have none), over the last 14 days, ignoring what was already sent and the schedule.
   * Marked as a test; records nothing as delivered.
   */
  async function queueTest(adminId: string) {
    const at = now()
    const alerts = await queryRows(`select id, name, filters, created_at from public.job_alerts where user_id = $1 order by created_at asc limit 1`, [adminId])
    const alert = alerts[0]
    const source = {
      id: alert ? String(alert.id) : '00000000-0000-0000-0000-000000000000',
      userId: adminId,
      filters: alert?.filters ?? {},
      lastSentAt: null,
      createdAt: new Date(at.getTime() - LOOKBACK_DAYS * DAY_MS),
    }
    const matches = await matchesFor(source, at, { ignoreHistory: true })
    const payload: JobAlertEmailPayload = {
      alertId: source.id,
      alertName: alert ? String(alert.name) : 'Jobs for you',
      jobs: matches.map(({ job, match }) => emailJob(job, jobMatchDisplay(match)?.label ?? 'Match')),
      test: true,
    }
    await queryRows(
      `insert into public.ranking_emails (dedupe_key, recipient_id, topic, payload) values ($1, $2, 'job_alerts', $3::jsonb)`,
      [`test/job_alert/${adminId}/${at.getTime()}`, adminId, JSON.stringify(payload)],
    )
    return { jobs: matches.length }
  }

  return { run, processAlert, matchesFor, queueTest, dueAlerts }
}

/** The outbox worker's sweep: every 15 minutes; each pass handles one batch of due alerts. */
export function createJobAlertSweep(sender = createJobAlertSender()) {
  return { name: 'job_alerts', everyMs: 15 * 60_000, requiresTable: 'ranking_emails', run: () => sender.run() }
}

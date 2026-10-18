/**
 * Round H (H7): "Urgent" on a job lasts 14 days from when it was set (jobs.urgent_since, migration 0089),
 * and an organization may have at most 2 live urgent jobs at a time. The billing plans have no urgent
 * allowance of their own today, so this limit is the only one (the stricter of the two). Pure, safe to
 * import from client and server code.
 */
export const URGENT_DAYS = 14
export const URGENT_LIMIT_PER_COMPANY = 2

const DAY_MS = 24 * 60 * 60 * 1000

/** SQL: the job still counts as urgent (set, and set less than 14 days ago). */
export function urgentActiveSql(alias = 'j') {
  return `(${alias}.urgent and ${alias}.urgent_since is not null and ${alias}.urgent_since > now() - interval '${URGENT_DAYS} days')`
}

export const URGENT_LIMIT_MESSAGE =
  `Your organization already has ${URGENT_LIMIT_PER_COMPANY} live urgent jobs. Each job stays urgent for ${URGENT_DAYS} days; untick Urgent on one of them, or save this job without it.`

export type UrgentWindow = { active: boolean; since: Date; endsAt: Date }

/** The urgent window of a job, or null when it was never marked urgent. */
export function urgentWindow(urgent: boolean, urgentSince: string | Date | null | undefined, now: Date = new Date()): UrgentWindow | null {
  if (!urgent || !urgentSince) return null
  const since = urgentSince instanceof Date ? urgentSince : new Date(urgentSince)
  if (Number.isNaN(since.getTime())) return null
  const endsAt = new Date(since.getTime() + URGENT_DAYS * DAY_MS)
  return { active: endsAt.getTime() > now.getTime(), since, endsAt }
}

const shortDate = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })

/** "Urgent since 3 Oct · ends 17 Oct", "Urgent ended 17 Oct", or null when the job is not urgent. */
export function urgentWindowLabel(urgent: boolean, urgentSince: string | Date | null | undefined, now: Date = new Date()) {
  const window = urgentWindow(urgent, urgentSince, now)
  if (!window) return null
  return window.active
    ? `Urgent since ${shortDate.format(window.since)} · ends ${shortDate.format(window.endsAt)}`
    : `Urgent ended ${shortDate.format(window.endsAt)}`
}

/**
 * The single source of truth for the job lifecycle.
 *
 *   Draft ──publish──▶ Published ──archive──▶ Archived ──republish──▶ Published
 *     │                                          │
 *     └──────────────delete──────────────────────┴──▶ Deleted (soft delete)
 *
 * The database stores Archived as status 'closed'. Deleted jobs keep status 'closed' and get a
 * deleted_at timestamp so the applications stay in the applicants' history.
 *
 * Server actions call validateJobTransition before every change, and the hiring UI calls
 * availableJobActions so it only offers buttons for transitions that are allowed.
 */

export type JobListingStatus = 'draft' | 'published' | 'closed'
export type JobLifecycleAction = 'publish' | 'archive' | 'republish' | 'delete'

export type JobLifecycleSnapshot = {
  status: JobListingStatus
  deleted: boolean
  /** The latest Sea N Shore moderation action on this job removed it. */
  moderationRemoved: boolean
  /** YYYY-MM-DD or null. */
  applyUntil: string | null
  /** YYYY-MM-DD or null. */
  joiningUntil: string | null
  applicantCount: number
  /** The viewer posted the job, or is an owner/administrator of the organization that owns it. */
  canDelete: boolean
}

export const JOB_LIFECYCLE_TRANSITIONS: Record<
  JobLifecycleAction,
  { from: readonly JobListingStatus[]; to: JobListingStatus; label: string }
> = {
  publish: { from: ['draft'], to: 'published', label: 'Publish' },
  archive: { from: ['published'], to: 'closed', label: 'Archive' },
  republish: { from: ['closed'], to: 'published', label: 'Republish' },
  delete: { from: ['draft', 'closed'], to: 'closed', label: 'Delete' },
}

export const JOB_LIFECYCLE_ACTION_ORDER: readonly JobLifecycleAction[] = ['publish', 'republish', 'archive', 'delete']

export type JobTransitionErrorCode =
  | 'job_deleted'
  | 'transition_not_allowed'
  | 'delete_forbidden'
  | 'moderation_removed'
  | 'apply_until_invalid'
  | 'apply_until_past'
  | 'joining_window_past'

export type JobTransitionResult =
  | { ok: true; action: JobLifecycleAction; to: JobListingStatus; applyUntil: string | null }
  | { ok: false; code: JobTransitionErrorCode; message: string }

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

export function todayIsoDate(now: Date = new Date()) {
  return now.toISOString().slice(0, 10)
}

export function isIsoDate(value: string) {
  if (!ISO_DATE.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

export function formatLifecycleDate(value: string) {
  return new Intl.DateTimeFormat('en', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
    .format(new Date(`${value}T00:00:00.000Z`))
}

/** Applications are open when the apply-by date is empty or today or later. */
export function isApplyUntilOpen(applyUntil: string | null, today: string) {
  return !applyUntil || applyUntil >= today
}

function notAllowedMessage(action: JobLifecycleAction, status: JobListingStatus) {
  if (action === 'publish') {
    if (status === 'published') return 'This job is already live.'
    return 'Archived jobs are brought back with Republish.'
  }
  if (action === 'republish') {
    if (status === 'published') return 'This job is already live.'
    return 'Drafts go live with Publish.'
  }
  if (action === 'archive') {
    if (status === 'closed') return 'This job is already archived.'
    return 'Only live jobs can be archived. Delete the draft if you no longer need it.'
  }
  return 'Archive this job before deleting it, so candidates stop applying first.'
}

/**
 * Checks one lifecycle change. `options.applyUntil` replaces the job's apply-by date for this
 * change: undefined keeps the current date, null removes it, a string sets a new date.
 */
export function validateJobTransition(
  snapshot: JobLifecycleSnapshot,
  action: JobLifecycleAction,
  options: { today: string; applyUntil?: string | null },
): JobTransitionResult {
  const transition = JOB_LIFECYCLE_TRANSITIONS[action]
  if (snapshot.deleted) {
    return { ok: false, code: 'job_deleted', message: 'This job has already been deleted.' }
  }
  if (!transition.from.includes(snapshot.status)) {
    return { ok: false, code: 'transition_not_allowed', message: notAllowedMessage(action, snapshot.status) }
  }
  if (action === 'delete') {
    if (!snapshot.canDelete) {
      return {
        ok: false,
        code: 'delete_forbidden',
        message: 'Only the person who posted this job, or an owner or administrator of the organization, can delete it.',
      }
    }
    return { ok: true, action, to: transition.to, applyUntil: snapshot.applyUntil }
  }

  const applyUntil = options.applyUntil === undefined ? snapshot.applyUntil : options.applyUntil

  if (action === 'publish' || action === 'republish') {
    if (snapshot.moderationRemoved) {
      return {
        ok: false,
        code: 'moderation_removed',
        message: 'Sea N Shore moderation took this job down, so it cannot go live again. You can still review applicants or delete it.',
      }
    }
    if (applyUntil !== null && !isIsoDate(applyUntil)) {
      return { ok: false, code: 'apply_until_invalid', message: 'Enter the apply-by date as a full date.' }
    }
    if (applyUntil !== null && applyUntil < options.today) {
      return {
        ok: false,
        code: 'apply_until_past',
        message: `The apply-by date (${formatLifecycleDate(applyUntil)}) has passed. Choose a new date, or remove it, to ${action === 'republish' ? 'republish' : 'publish'}.`,
      }
    }
    if (snapshot.joiningUntil && snapshot.joiningUntil < options.today) {
      return {
        ok: false,
        code: 'joining_window_past',
        message: `The joining window ended on ${formatLifecycleDate(snapshot.joiningUntil)}. Edit the joining dates, then ${action === 'republish' ? 'republish' : 'publish'}.`,
      }
    }
  }

  return { ok: true, action, to: transition.to, applyUntil }
}

/** Actions the UI may offer. Date problems are resolved inside the action's confirmation step. */
export function availableJobActions(snapshot: JobLifecycleSnapshot): JobLifecycleAction[] {
  if (snapshot.deleted) return []
  return JOB_LIFECYCLE_ACTION_ORDER.filter((action) => {
    if (!JOB_LIFECYCLE_TRANSITIONS[action].from.includes(snapshot.status)) return false
    if (action === 'delete') return snapshot.canDelete
    if (action === 'publish' || action === 'republish') return !snapshot.moderationRemoved
    return true
  })
}

/**
 * Checks the apply-by date when job details are saved. A job that is (or will be) live must
 * have an apply-by date of today or later, or none at all, so it never goes live already closed.
 */
export function validateApplyUntilForStatus(
  status: JobListingStatus,
  applyUntil: string | null,
  today: string,
): { ok: true } | { ok: false; message: string } {
  if (applyUntil !== null && !isIsoDate(applyUntil)) {
    return { ok: false, message: 'Enter the apply-by date as a full date.' }
  }
  if (status === 'published' && applyUntil !== null && applyUntil < today) {
    return {
      ok: false,
      message: `The apply-by date (${formatLifecycleDate(applyUntil)}) is in the past. Choose today or a later date, or leave it empty.`,
    }
  }
  return { ok: true }
}

export type JobStatusKey = 'draft' | 'live' | 'expired' | 'archived' | 'removed' | 'deleted'

export type JobStatusPresentation = {
  key: JobStatusKey
  label: string
  description: string
  badgeClassName: string
}

export function jobStatusPresentation(snapshot: Pick<JobLifecycleSnapshot, 'status' | 'deleted' | 'moderationRemoved' | 'applyUntil'>, today: string): JobStatusPresentation {
  if (snapshot.deleted) {
    return { key: 'deleted', label: 'Deleted', description: 'This job has been deleted.', badgeClassName: 'bg-mist-100 text-muted' }
  }
  if (snapshot.status === 'closed' && snapshot.moderationRemoved) {
    return {
      key: 'removed',
      label: 'Removed by moderation',
      description: 'Sea N Shore moderation took this job down. It is hidden from job search and cannot go live again.',
      badgeClassName: 'bg-rose-50 text-rose-800',
    }
  }
  if (snapshot.status === 'draft') {
    return {
      key: 'draft',
      label: 'Draft',
      description: 'Only you and your hiring team can see this job. Publish it to start receiving applications.',
      badgeClassName: 'bg-ocean-50 text-ocean-800',
    }
  }
  if (snapshot.status === 'closed') {
    return {
      key: 'archived',
      label: 'Archived',
      description: 'Hidden from job search and closed to new applications. You can still review applicants.',
      badgeClassName: 'bg-mist-100 text-navy-800',
    }
  }
  if (!isApplyUntilOpen(snapshot.applyUntil, today)) {
    return {
      key: 'expired',
      label: 'Applications closed',
      description: `The apply-by date (${formatLifecycleDate(snapshot.applyUntil ?? today)}) has passed. Edit the date to reopen applications, or archive the job.`,
      badgeClassName: 'bg-amber-50 text-amber-900',
    }
  }
  return {
    key: 'live',
    label: 'Live',
    description: 'Visible in job search and accepting applications.',
    badgeClassName: 'bg-emerald-50 text-emerald-800',
  }
}

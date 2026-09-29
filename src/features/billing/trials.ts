import {
  addDays,
  trialDaysLeft,
  trialEndsAt,
  planForSubject,
  PLAN_LABELS,
  TRIAL_MONTHS,
  TRIAL_REMINDER_DAYS,
  type BillingSubject,
} from './plans'
import {
  TRIAL_BILLING_PROVIDER,
  type AccessRecord,
  type BillingStore,
  type LedgerActor,
  type TrialRecord,
} from './subscription-types'

/**
 * Free trial rules. Every function runs inside ONE database transaction (the store is
 * bound to it) and locks the member / organization first, like subscription-ledger.ts.
 *
 * A trial is an account_subscriptions row with status 'trialing' and billing_provider
 * 'trial', so entitlements, plan visibility and the hourly expiry sweep treat it like any
 * current plan, plus a public.plan_trials row that remembers the trial forever: one trial
 * per member and per organization, ever (unique indexes back this up).
 *
 * Nobody pays anything during the trial. Choosing a paid plan while it runs schedules the
 * mandate's first charge for the day the trial ends (subscription-service.startCheckout);
 * when Cashfree approves that mandate the ledger converts the trialing row in place
 * (attachAccess never shortens access). When the trial ends without a plan the row
 * expires like any lapsed plan and Pro-only content is hidden, never deleted.
 */

export class TrialNotAvailableError extends Error {
  constructor(readonly code: 'already_used' | 'plan_current') {
    super(`trial_${code}`)
    this.name = 'TrialNotAvailableError'
  }
}

export class TrialNotRunningError extends Error {
  constructor() {
    super('trial_not_running')
    this.name = 'TrialNotRunningError'
  }
}

function iso(date: Date) {
  return date.toISOString()
}

export function trialProviderId(trialId: string) {
  return `trial_${trialId}`
}

function actorFields(actor: LedgerActor) {
  return { actorType: actor.type, actorProfileId: actor.profileId ?? null }
}

function subjectAudit(subject: BillingSubject) {
  return subject.kind === 'profile' ? { profileId: subject.profileId } : { companyId: subject.companyId }
}

async function auditTrial(store: BillingStore, actor: LedgerActor, trial: TrialRecord, action: string, details: Record<string, unknown> = {}) {
  await store.audit({
    ...actorFields(actor),
    subjectType: 'plan_trial',
    subjectId: trial.id,
    action,
    amountMinor: 0,
    currency: 'INR',
    provider: TRIAL_BILLING_PROVIDER,
    details: { ...subjectAudit(trial.subject), plan: trial.planCode, endsAt: trial.endsAt, ...details },
  })
}

/** Can this subject start a free trial right now? Pure: the billing page uses it too. */
export function trialEligibility(input: { trial: TrialRecord | null; currentAccess: AccessRecord | null }) {
  if (input.trial) return { eligible: false as const, reason: 'already_used' as const }
  if (input.currentAccess) return { eligible: false as const, reason: 'plan_current' as const }
  return { eligible: true as const, reason: null }
}

/** The trial's own access row, while it is still the row that grants the plan. */
export async function trialAccess(store: BillingStore, trial: TrialRecord, now: Date) {
  const current = await store.getCurrentAccess(trial.subject, now)
  return current && current.billingProvider === TRIAL_BILLING_PROVIDER && current.providerSubscriptionId === trialProviderId(trial.id)
    ? current
    : null
}

/**
 * Starts the subject's free trial: TRIAL_MONTHS of the plan from now, no payment details.
 * Throws TrialNotAvailableError when they already had one or already have a current plan.
 */
export async function startTrial(store: BillingStore, input: { subject: BillingSubject; actor: LedgerActor; now: Date }) {
  await store.lockSubject(input.subject)
  const eligibility = trialEligibility({
    trial: await store.getTrial(input.subject),
    currentAccess: await store.getCurrentAccess(input.subject, input.now),
  })
  if (!eligibility.eligible) throw new TrialNotAvailableError(eligibility.reason)

  const plan = planForSubject(input.subject)
  const endsAt = trialEndsAt(input.now, plan)
  // Frees the "one current row per subject" slot from any lapsed row before inserting.
  await store.expireLapsedAccess(input.subject, input.now)
  const trial = await store.insertTrial({
    subject: input.subject,
    planCode: plan,
    startedBy: input.actor.profileId ?? null,
    startedAt: iso(input.now),
    endsAt: iso(endsAt),
  })
  const access = await store.insertAccess({
    subject: input.subject,
    planCode: plan,
    status: 'trialing',
    billingProvider: TRIAL_BILLING_PROVIDER,
    providerSubscriptionId: trialProviderId(trial.id),
    periodStartedAt: iso(input.now),
    periodEndsAt: iso(endsAt),
    cancelAtPeriodEnd: false,
  })
  await auditTrial(store, input.actor, trial, 'trial_started', { months: TRIAL_MONTHS[plan], accessId: access.id })
  return { trial, access }
}

/** Admin: move the end of a running trial (later or earlier, never before now). */
export async function extendTrial(store: BillingStore, input: { trialId: string; endsAt: Date; actor: LedgerActor; now: Date }) {
  const trial = await store.getTrialById(input.trialId)
  if (!trial || trial.endedAt) throw new TrialNotRunningError()
  await store.lockSubject(trial.subject)
  const access = await trialAccess(store, trial, input.now)
  if (!access) throw new TrialNotRunningError()
  const endsAt = input.endsAt.getTime() > input.now.getTime() ? input.endsAt : addDays(input.now, 1)
  const updated = await store.updateTrial(trial.id, {
    endsAt: iso(endsAt),
    extendedBy: input.actor.profileId ?? null,
    extendedAt: iso(input.now),
    // A reminder for a window that is now in the future again should go out once more.
    ...(trialDaysLeft(input.now, endsAt) > 7 ? { reminder7dSentAt: null } : {}),
    ...(trialDaysLeft(input.now, endsAt) > 1 ? { reminder1dSentAt: null } : {}),
  })
  const updatedAccess = await store.updateAccess(access.id, { periodEndsAt: iso(endsAt) })
  await auditTrial(store, input.actor, updated, 'trial_extended', { previousEndsAt: trial.endsAt, accessId: updatedAccess.id })
  return { trial: updated, access: updatedAccess }
}

/** Admin: end a running trial now. The account returns to the free plan at once. */
export async function endTrial(store: BillingStore, input: { trialId: string; actor: LedgerActor; now: Date }) {
  const trial = await store.getTrialById(input.trialId)
  if (!trial || trial.endedAt) throw new TrialNotRunningError()
  await store.lockSubject(trial.subject)
  const access = await trialAccess(store, trial, input.now)
  if (!access) throw new TrialNotRunningError()
  const updated = await store.updateTrial(trial.id, { endsAt: iso(input.now), endedAt: iso(input.now), endedReason: 'admin_ended' })
  const endedAccess = await store.updateAccess(access.id, { status: 'expired', periodEndsAt: iso(input.now) })
  await auditTrial(store, input.actor, updated, 'trial_ended', { reason: 'admin_ended', accessId: endedAccess.id })
  return { trial: updated, access: endedAccess }
}

/**
 * Closes the plan_trials record of a trial whose end date has passed: 'converted' when
 * the subject moved on to a Cashfree mandate, otherwise 'expired' (the access row was or
 * will be expired by expireLapsedAccess). Idempotent.
 */
export async function closeTrialRecord(store: BillingStore, trial: TrialRecord, now: Date) {
  if (trial.endedAt || Date.parse(trial.endsAt) > now.getTime()) return trial
  const current = await store.getCurrentAccess(trial.subject, now)
  const converted = Boolean(current && current.billingProvider !== TRIAL_BILLING_PROVIDER)
  const updated = await store.updateTrial(trial.id, { endedAt: iso(now), endedReason: converted ? 'converted' : 'expired' })
  await auditTrial(store, { type: 'system' }, updated, 'trial_closed', { reason: updated.endedReason })
  return updated
}

export type TrialReminder = { trial: TrialRecord; days: 7 | 1; daysLeft: number }

/** Which reminders a still-running trial is due for at `now` (7 days and 1 day before it ends). */
export function dueTrialReminders(trial: TrialRecord, now: Date): TrialReminder[] {
  if (trial.endedAt) return []
  const endsAt = new Date(trial.endsAt)
  if (endsAt.getTime() <= now.getTime()) return []
  const daysLeft = trialDaysLeft(now, endsAt)
  const due: TrialReminder[] = []
  for (const days of TRIAL_REMINDER_DAYS) {
    const sentAt = days === 7 ? trial.reminder7dSentAt : trial.reminder1dSentAt
    if (sentAt || daysLeft > days) continue
    due.push({ trial, days, daysLeft })
  }
  // Only the most urgent window: a trial started with 5 days left gets the 1-day reminder later, not both at once.
  return due.length ? [due[due.length - 1]!] : []
}

export function trialReminderCopy(trial: TrialRecord, reminder: Pick<TrialReminder, 'days' | 'daysLeft'>) {
  const plan = PLAN_LABELS[trial.planCode]
  const when = reminder.daysLeft <= 1 ? 'tomorrow' : `in ${reminder.daysLeft} days`
  return {
    dedupeKey: `plan_trial_ending:${reminder.days}d:${trial.id}`,
    subject: `Your ${plan} free trial ends ${when}`,
    text: `Your ${plan} free trial ends ${when}. Choose a plan to keep ${plan}; the first payment is only taken on the day the trial ends. If you do nothing, your account returns to the free plan and anything published with ${plan} is locked, not deleted.`,
  }
}

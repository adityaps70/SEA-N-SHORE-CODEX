import { withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { getNewsletterConfig, newsletterSendingStatus } from '@/features/newsletter/config'
import { createSesV2Client } from '@/features/newsletter/ses-client'
import { logBillingEvent } from './cashfree-subscriptions'
import { syncPlanContentVisibility } from './plan-visibility'
import { TRIAL_REMINDER_DAYS, type BillingSubject } from './plans'
import { subscriptionRepository, type SubscriptionRepository } from './subscription-repository'
import { createSqlBillingStore } from './subscription-store'
import type { BillingStore, LedgerActor, TrialRecord } from './subscription-types'
import { closeTrialRecord, dueTrialReminders, endTrial, extendTrial, startTrial, trialReminderCopy } from './trials'

/**
 * Free trials for Creator Pro and Organization Pro: start (member / organization admin),
 * extend and end (Sea N Shore admins), and the hourly sweep that closes ended trials and
 * sends the "ends in 7 days / tomorrow" reminders (in-app now; by email too once SES
 * production sending is enabled for the newsletter sender).
 */

type RunInTransaction = <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => Promise<T>

export type TrialReminderMailer = (input: { to: string; subject: string; text: string }) => Promise<boolean>

/** Sends through the newsletter's verified SES sender when production sending is on; otherwise a no-op. */
export function createTrialReminderMailer(env: Record<string, string | undefined> = process.env): TrialReminderMailer | null {
  const config = getNewsletterConfig(env)
  if (!newsletterSendingStatus(config).enabled || !config.fromAddress) return null
  const client = createSesV2Client({ region: config.region })
  return async ({ to, subject, text }) => {
    await client.sendEmail({
      from: config.fromAddress!,
      to,
      subject,
      text,
      html: `<p>${text.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</p><p><a href="${config.siteUrl}/settings/billing">Choose a plan</a></p>`,
      configurationSetName: config.configurationSetName,
    })
    return true
  }
}

export function createTrialService(deps: {
  repository?: SubscriptionRepository
  transaction?: RunInTransaction
  storeFor?: (tx: DatabaseQueryClient) => BillingStore
  syncVisibility?: (subject: BillingSubject | null) => Promise<unknown>
  mailer?: TrialReminderMailer | null
  now?: () => Date
  log?: (message: string, details?: Record<string, unknown>) => void
} = {}) {
  const repository = deps.repository ?? subscriptionRepository
  const transaction: RunInTransaction = deps.transaction ?? withTransaction
  const storeFor = deps.storeFor ?? createSqlBillingStore
  const syncVisibility = deps.syncVisibility ?? ((subject: BillingSubject | null) => syncPlanContentVisibility(subject))
  const now = deps.now ?? (() => new Date())
  const log = deps.log ?? logBillingEvent
  const mailer = deps.mailer === undefined ? createTrialReminderMailer() : deps.mailer

  async function syncContent(subject: BillingSubject | null) {
    try {
      await syncVisibility(subject)
    } catch (error) {
      log('billing_plan_visibility_sync_failed', { subject: subject?.kind ?? 'all', message: error instanceof Error ? error.message : null })
    }
  }

  async function start(input: { subject: BillingSubject; actor: LedgerActor }) {
    const result = await transaction((tx) => startTrial(storeFor(tx), { subject: input.subject, actor: input.actor, now: now() }))
    // Anything the owner published while on the free plan comes back straight away.
    await syncContent(input.subject)
    return result
  }

  async function extend(input: { trialId: string; endsAt: Date; actor: LedgerActor }) {
    const result = await transaction((tx) => extendTrial(storeFor(tx), { trialId: input.trialId, endsAt: input.endsAt, actor: input.actor, now: now() }))
    await syncContent(result.trial.subject)
    return result
  }

  async function end(input: { trialId: string; actor: LedgerActor }) {
    const result = await transaction((tx) => endTrial(storeFor(tx), { trialId: input.trialId, actor: input.actor, now: now() }))
    await syncContent(result.trial.subject)
    return result
  }

  async function remind(trial: TrialRecord, at: Date) {
    const due = dueTrialReminders(trial, at)
    let sent = 0
    for (const reminder of due) {
      const copy = trialReminderCopy(trial, reminder)
      const recipients = await repository.listTrialRecipients(trial.subject)
      for (const recipient of recipients) {
        await repository.upsertTrialNotification({ recipientId: recipient.profileId, dedupeKey: copy.dedupeKey })
        if (mailer && recipient.email) {
          try {
            await mailer({ to: recipient.email, subject: copy.subject, text: copy.text })
          } catch (error) {
            log('billing_trial_reminder_email_failed', { trialId: trial.id, message: error instanceof Error ? error.message : null })
          }
        }
      }
      await transaction((tx) => storeFor(tx).updateTrial(trial.id, reminder.days === 7 ? { reminder7dSentAt: at.toISOString() } : { reminder1dSentAt: at.toISOString() }))
      sent += 1
    }
    return sent
  }

  /** Hourly (from the billing sweep): close ended trial records, send due reminders. Idempotent. */
  async function sweep(at: Date = now()) {
    const summary = { closed: 0, reminders: 0, failures: 0 }
    const horizon = Math.max(...TRIAL_REMINDER_DAYS)
    for (const trial of await repository.listOpenTrials(at, horizon)) {
      try {
        if (Date.parse(trial.endsAt) <= at.getTime()) {
          const closed = await transaction((tx) => closeTrialRecord(storeFor(tx), trial, at))
          if (closed.endedAt) summary.closed += 1
          continue
        }
        summary.reminders += await remind(trial, at)
      } catch (error) {
        summary.failures += 1
        log('billing_trial_sweep_item_failed', { trialId: trial.id, message: error instanceof Error ? error.message : null })
      }
    }
    return summary
  }

  return { start, extend, end, sweep }
}

export type TrialService = ReturnType<typeof createTrialService>

let defaultService: TrialService | null = null
function service() {
  defaultService ??= createTrialService()
  return defaultService
}

export const trialService: TrialService = {
  start: (input) => service().start(input),
  extend: (input) => service().extend(input),
  end: (input) => service().end(input),
  sweep: (at) => service().sweep(at),
}

export function runTrialSweep(at: Date) {
  return trialService.sweep(at)
}

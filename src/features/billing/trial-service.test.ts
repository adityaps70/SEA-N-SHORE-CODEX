import { describe, expect, it, vi } from 'vitest'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { addDays } from './plans'
import type { SubscriptionRepository } from './subscription-repository'
import { createTrialReminderMailer, createTrialService } from './trial-service'
import { createMemoryBillingStore } from './testing/memory-billing-store'

const profileId = '33333333-3333-4333-8333-333333333333'
const companyId = '55555555-5555-4555-8555-555555555555'
const NOW = new Date('2026-10-01T06:00:00.000Z')

function setup(options: { mailer?: ((input: { to: string; subject: string; text: string }) => Promise<boolean>) | null; emails?: boolean } = {}) {
  let now = NOW
  const memory = createMemoryBillingStore(() => now)
  const notifications: Array<{ recipientId: string; dedupeKey: string }> = []
  const repository = {
    listOpenTrials: vi.fn(async (at: Date, withinDays: number) => [...memory.trials.values()].filter((trial) => !trial.endedAt && Date.parse(trial.endsAt) <= at.getTime() + withinDays * 86_400_000)),
    listTrialRecipients: vi.fn(async (subject: { kind: string; profileId?: string; companyId?: string }) => subject.kind === 'profile'
      ? [{ profileId: subject.profileId!, email: options.emails ? 'meera@example.com' : null }]
      : [{ profileId: 'owner-1', email: null }, { profileId: 'admin-1', email: options.emails ? 'admin@example.com' : null }]),
    upsertTrialNotification: vi.fn(async (input: { recipientId: string; dedupeKey: string }) => { notifications.push(input) }),
  }
  const syncVisibility = vi.fn(async () => ({ hidden: 0, restored: 0 }))
  const log = vi.fn()
  const service = createTrialService({
    repository: repository as unknown as SubscriptionRepository,
    transaction: async (fn) => fn({} as DatabaseQueryClient),
    storeFor: () => memory.store,
    syncVisibility,
    mailer: options.mailer ?? null,
    now: () => now,
    log,
  })
  return { service, memory, repository, notifications, syncVisibility, log, setNow: (next: Date) => { now = next } }
}

describe('trial service', () => {
  it('starts a trial and brings the owner’s hidden items back at once', async () => {
    const { service, memory, syncVisibility } = setup()
    const { access } = await service.start({ subject: { kind: 'profile', profileId }, actor: { type: 'member', profileId } })
    expect(access.status).toBe('trialing')
    expect(syncVisibility).toHaveBeenCalledWith({ kind: 'profile', profileId })
    expect(memory.trials.size).toBe(1)
  })

  it('sends the 7-day and 1-day reminders once each, to every organization manager, and closes ended trials', async () => {
    const { service, memory, notifications, repository, setNow } = setup()
    const { trial } = await service.start({ subject: { kind: 'company', companyId }, actor: { type: 'member', profileId } })
    const endsAt = new Date(trial.endsAt)

    setNow(addDays(endsAt, -10))
    await expect(service.sweep()).resolves.toEqual({ closed: 0, reminders: 0, failures: 0 })

    setNow(addDays(endsAt, -7))
    await expect(service.sweep()).resolves.toMatchObject({ reminders: 1 })
    expect(notifications).toEqual([
      { recipientId: 'owner-1', dedupeKey: `plan_trial_ending:7d:${trial.id}` },
      { recipientId: 'admin-1', dedupeKey: `plan_trial_ending:7d:${trial.id}` },
    ])
    await expect(service.sweep()).resolves.toMatchObject({ reminders: 0 })

    setNow(addDays(endsAt, -1))
    await expect(service.sweep()).resolves.toMatchObject({ reminders: 1 })
    expect(notifications.at(-1)).toEqual({ recipientId: 'admin-1', dedupeKey: `plan_trial_ending:1d:${trial.id}` })
    expect(memory.trials.get(trial.id)).toMatchObject({ reminder7dSentAt: expect.any(String), reminder1dSentAt: expect.any(String) })

    setNow(addDays(endsAt, 1))
    await expect(service.sweep()).resolves.toMatchObject({ closed: 1, reminders: 0 })
    expect(memory.trials.get(trial.id)).toMatchObject({ endedReason: 'expired', endedAt: addDays(endsAt, 1).toISOString() })
    await expect(service.sweep()).resolves.toMatchObject({ closed: 0 })
    expect(repository.upsertTrialNotification).toHaveBeenCalledTimes(4)
  })

  it('emails the reminder too when a mailer is available, and keeps going when it fails', async () => {
    const mailer = vi.fn(async () => { throw new Error('ses down') })
    const { service, notifications, log, setNow } = setup({ mailer, emails: true })
    const { trial } = await service.start({ subject: { kind: 'profile', profileId }, actor: { type: 'member', profileId } })
    setNow(addDays(new Date(trial.endsAt), -7))
    await expect(service.sweep()).resolves.toMatchObject({ reminders: 1, failures: 0 })
    expect(mailer).toHaveBeenCalledWith(expect.objectContaining({ to: 'meera@example.com', subject: 'Your Creator Pro free trial ends in 7 days' }))
    expect(log).toHaveBeenCalledWith('billing_trial_reminder_email_failed', expect.any(Object))
    expect(notifications).toHaveLength(1)
  })

  it('has no mailer until SES production sending is enabled for the newsletter sender', () => {
    expect(createTrialReminderMailer({})).toBeNull()
    expect(createTrialReminderMailer({ NEWSLETTER_FROM_ADDRESS: 'Sea N Shore <news@example.com>', NEWSLETTER_SES_PRODUCTION_ACCESS: 'false' })).toBeNull()
  })

  it('lets admins extend and end a trial, syncing the owner’s content each time', async () => {
    const { service, syncVisibility, memory, setNow } = setup()
    const { trial } = await service.start({ subject: { kind: 'profile', profileId }, actor: { type: 'member', profileId } })
    const extended = await service.extend({ trialId: trial.id, endsAt: addDays(new Date(trial.endsAt), 14), actor: { type: 'admin', profileId: 'admin-1' } })
    expect(extended.trial.endsAt).toBe(addDays(new Date(trial.endsAt), 14).toISOString())
    setNow(addDays(NOW, 2))
    const ended = await service.end({ trialId: trial.id, actor: { type: 'admin', profileId: 'admin-1' } })
    expect(ended.access.status).toBe('expired')
    expect(await memory.store.getCurrentAccess({ kind: 'profile', profileId }, addDays(NOW, 2))).toBeNull()
    expect(syncVisibility).toHaveBeenCalledTimes(3)
  })
})

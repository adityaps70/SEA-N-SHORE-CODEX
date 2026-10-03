import { describe, expect, it } from 'vitest'
import { addDays, trialEndsAt } from './plans'
import { closeTrialRecord, dueTrialReminders, endTrial, extendTrial, startTrial, TrialNotAvailableError, trialEligibility, trialReminderCopy } from './trials'
import { createMemoryBillingStore } from './testing/memory-billing-store'

const profileId = '33333333-3333-4333-8333-333333333333'
const companyId = '55555555-5555-4555-8555-555555555555'
const member = { kind: 'profile' as const, profileId }
const organization = { kind: 'company' as const, companyId }
const NOW = new Date('2026-10-01T06:00:00.000Z')
const actor = { type: 'member' as const, profileId }

describe('free trials', () => {
  it('starts Creator Pro for 3 months and Organization Pro for 2 months with no payment details', async () => {
    const memory = createMemoryBillingStore(() => NOW)
    const personal = await startTrial(memory.store, { subject: member, actor, now: NOW })
    expect(personal.access).toMatchObject({ planCode: 'creator_pro', status: 'trialing', billingProvider: 'trial', periodEndsAt: '2027-01-01T06:00:00.000Z' })
    expect(personal.trial.endsAt).toBe(trialEndsAt(NOW, 'creator_pro').toISOString())

    const company = await startTrial(memory.store, { subject: organization, actor, now: NOW })
    expect(company.access).toMatchObject({ planCode: 'organization_pro', status: 'trialing', periodEndsAt: '2026-12-01T06:00:00.000Z' })
    expect(await memory.store.getCurrentAccess(member, NOW)).toMatchObject({ status: 'trialing' })
    expect(memory.audits.map((entry) => entry.action)).toEqual(['trial_started', 'trial_started'])
  })

  it('allows one trial per member and per organization, ever — even after it ended', async () => {
    const memory = createMemoryBillingStore(() => NOW)
    await startTrial(memory.store, { subject: member, actor, now: NOW })
    await expect(startTrial(memory.store, { subject: member, actor, now: NOW })).rejects.toMatchObject({ code: 'already_used' })

    const afterTrial = addDays(NOW, 120)
    expect(await memory.store.expireLapsedAccess(member, afterTrial)).toHaveLength(1)
    await expect(startTrial(memory.store, { subject: member, actor, now: afterTrial })).rejects.toBeInstanceOf(TrialNotAvailableError)
    expect(trialEligibility({ trial: await memory.store.getTrial(member), currentAccess: null })).toEqual({ eligible: false, reason: 'already_used' })
  })

  it('refuses a trial while a paid plan is current', async () => {
    const memory = createMemoryBillingStore(() => NOW)
    await memory.store.insertAccess({
      subject: member, planCode: 'creator_pro', status: 'active', billingProvider: 'cashfree', providerSubscriptionId: 'snss_x',
      periodStartedAt: NOW.toISOString(), periodEndsAt: addDays(NOW, 30).toISOString(), cancelAtPeriodEnd: false,
    })
    await expect(startTrial(memory.store, { subject: member, actor, now: NOW })).rejects.toMatchObject({ code: 'plan_current' })
    expect(trialEligibility({ trial: null, currentAccess: null })).toEqual({ eligible: true, reason: null })
  })

  it('returns the account to the free plan when the trial ends, without deleting anything', async () => {
    const memory = createMemoryBillingStore(() => NOW)
    const { trial } = await startTrial(memory.store, { subject: member, actor, now: NOW })
    const lastDay = addDays(new Date(trial.endsAt), -1)
    expect(await memory.store.getCurrentAccess(member, lastDay)).not.toBeNull()
    const ended = new Date(trial.endsAt)
    expect(await memory.store.getCurrentAccess(member, ended)).toBeNull()
    expect(await memory.store.expireLapsedAccess(member, ended)).toMatchObject([{ status: 'expired', billingProvider: 'trial' }])
    const closed = await closeTrialRecord(memory.store, trial, ended)
    expect(closed).toMatchObject({ endedReason: 'expired', endedAt: ended.toISOString() })
    // The trial record is kept: it is what makes a second trial impossible.
    expect(await memory.store.getTrial(member)).toMatchObject({ id: trial.id })
  })

  it('records a trial as converted when a paid plan took over before it ended', async () => {
    const memory = createMemoryBillingStore(() => NOW)
    const { trial, access } = await startTrial(memory.store, { subject: member, actor, now: NOW })
    await memory.store.updateAccess(access.id, { status: 'active', billingProvider: 'cashfree', providerSubscriptionId: 'snss_new', periodEndsAt: addDays(new Date(trial.endsAt), 33).toISOString() })
    const closed = await closeTrialRecord(memory.store, trial, addDays(new Date(trial.endsAt), 1))
    expect(closed.endedReason).toBe('converted')
    expect(await closeTrialRecord(memory.store, trial, NOW)).toMatchObject({ endedAt: null })
  })

  it('lets an admin extend or end a running trial, and nothing else', async () => {
    const memory = createMemoryBillingStore(() => NOW)
    const admin = { type: 'admin' as const, profileId: '99999999-9999-4999-8999-999999999999' }
    const { trial } = await startTrial(memory.store, { subject: organization, actor, now: NOW })
    const extended = await extendTrial(memory.store, { trialId: trial.id, endsAt: new Date('2026-12-15T06:00:00.000Z'), actor: admin, now: NOW })
    expect(extended.trial).toMatchObject({ endsAt: '2026-12-15T06:00:00.000Z', extendedBy: admin.profileId })
    expect(extended.access.periodEndsAt).toBe('2026-12-15T06:00:00.000Z')

    const ended = await endTrial(memory.store, { trialId: trial.id, actor: admin, now: addDays(NOW, 3) })
    expect(ended.trial).toMatchObject({ endedReason: 'admin_ended' })
    expect(ended.access).toMatchObject({ status: 'expired', periodEndsAt: addDays(NOW, 3).toISOString() })
    expect(await memory.store.getCurrentAccess(organization, addDays(NOW, 3))).toBeNull()
    await expect(endTrial(memory.store, { trialId: trial.id, actor: admin, now: addDays(NOW, 4) })).rejects.toThrow('trial_not_running')
  })

  it('reminds 7 days and 1 day before the end, once each', async () => {
    const memory = createMemoryBillingStore(() => NOW)
    const { trial } = await startTrial(memory.store, { subject: member, actor, now: NOW })
    const endsAt = new Date(trial.endsAt)
    expect(dueTrialReminders(trial, NOW)).toEqual([])
    const weekBefore = addDays(endsAt, -7)
    expect(dueTrialReminders(trial, weekBefore)).toMatchObject([{ days: 7, daysLeft: 7 }])
    const sent7 = await memory.store.updateTrial(trial.id, { reminder7dSentAt: weekBefore.toISOString() })
    expect(dueTrialReminders(sent7, addDays(endsAt, -6))).toEqual([])
    expect(dueTrialReminders(sent7, addDays(endsAt, -1))).toMatchObject([{ days: 1, daysLeft: 1 }])
    const sent1 = await memory.store.updateTrial(trial.id, { reminder1dSentAt: addDays(endsAt, -1).toISOString() })
    expect(dueTrialReminders(sent1, addDays(endsAt, -0.5))).toEqual([])
    expect(dueTrialReminders(sent1, addDays(endsAt, 1))).toEqual([])
    const copy = trialReminderCopy(trial, { days: 1, daysLeft: 1 })
    expect(copy.subject).toBe('Your Creator Pro free trial ends tomorrow')
    expect(copy.dedupeKey).toBe(`plan_trial_ending:1d:${trial.id}`)
    expect(copy.text).toContain('first payment is only taken on the day the trial ends')
  })
})

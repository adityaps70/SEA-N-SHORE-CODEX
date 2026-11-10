'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { hasAdminStepUp } from '@/features/account-security/admin-step-up-runtime'
import { legacyFinalReminderRepository, type FinalPrepareResult, type FinalStartResult } from './final-reminder-repository'
import { legacyFinalReminderTestSender } from './final-reminder-test'
import type { LegacyReminderTestResult } from './reminder-test'

// The final reminder: the same Prepare → review → Start sending → Stop steps, on its own table, plus Resume.

const batchSchema = z.coerce.number().int().refine((value) => value === 10 || value === 50 || value === 100)

export type FinalResumeResult = { status: 'resumed' | 'not_paused' | 'step_up_required' }

function refresh() {
  revalidatePath('/admin/legacy-invites')
}

export async function prepareLegacyFinalReminderBatch(limit: number): Promise<FinalPrepareResult> {
  const admin = await requirePlatformAdministratorUser()
  const parsed = batchSchema.safeParse(limit)
  if (!parsed.success) throw new Error('legacy_final_reminder_batch_invalid')
  const result = await legacyFinalReminderRepository.prepareEligible(parsed.data, admin.id)
  refresh()
  return result
}

export async function startPreparedLegacyFinalReminders(): Promise<FinalStartResult> {
  await requirePlatformAdministratorUser()
  const result = await legacyFinalReminderRepository.startPrepared()
  refresh()
  return result
}

export async function cancelPreparedLegacyFinalReminders(): Promise<number> {
  await requirePlatformAdministratorUser()
  const cancelled = await legacyFinalReminderRepository.cancelPrepared()
  refresh()
  return cancelled
}

export async function stopUnsentLegacyFinalReminders(): Promise<number> {
  await requirePlatformAdministratorUser()
  const stopped = await legacyFinalReminderRepository.stopUnsent()
  refresh()
  return stopped
}

/**
 * Lifts an auto-pause. Only a platform administrator whose current sign-in has made the admin step-up (password and
 * authenticator code, or a backup code, in Settings → Two-step verification) may press it; who and when is recorded.
 */
export async function resumeLegacyFinalReminders(): Promise<FinalResumeResult> {
  const admin = await requirePlatformAdministratorUser()
  if (!(await hasAdminStepUp(admin.id))) return { status: 'step_up_required' }
  const resumed = await legacyFinalReminderRepository.resume(admin.id)
  refresh()
  return { status: resumed ? 'resumed' : 'not_paused' }
}

/** "Send test to me": the exact final reminder to the signed-in admin's own verified email. No recipient field. */
export async function sendLegacyFinalReminderTest(): Promise<LegacyReminderTestResult> {
  const admin = await requirePlatformAdministratorUser()
  return legacyFinalReminderTestSender.send({ id: admin.id, email: admin.email })
}

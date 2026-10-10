'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { legacyReminderRepository } from './reminder-repository'
import { legacyInviteRepository } from './repository'

const batchSchema = z.coerce.number().int().refine((value) => value === 10 || value === 50 || value === 100)

function refresh() {
  revalidatePath('/admin/legacy-invites')
}

export async function prepareLegacyInviteBatch(formData: FormData) {
  const admin = await requirePlatformAdministratorUser()
  const parsed = batchSchema.safeParse(formData.get('limit'))
  if (!parsed.success) throw new Error('legacy_invite_batch_invalid')
  await legacyInviteRepository.prepareEligible(parsed.data, admin.id)
  refresh()
}

export async function startPreparedLegacyInvites() {
  await requirePlatformAdministratorUser()
  await legacyInviteRepository.startPrepared()
  refresh()
}

export async function cancelPreparedLegacyInvites() {
  await requirePlatformAdministratorUser()
  await legacyInviteRepository.cancelPrepared()
  refresh()
}

export async function stopUnsentLegacyInvites() {
  await requirePlatformAdministratorUser()
  await legacyInviteRepository.stopUnsent()
  refresh()
}

// The second reminder: the same Prepare → review → Start sending → Stop steps, on its own table.

export async function prepareLegacyReminderBatch(formData: FormData) {
  const admin = await requirePlatformAdministratorUser()
  const parsed = batchSchema.safeParse(formData.get('limit'))
  if (!parsed.success) throw new Error('legacy_reminder_batch_invalid')
  await legacyReminderRepository.prepareEligible(parsed.data, admin.id)
  refresh()
}

export async function startPreparedLegacyReminders() {
  await requirePlatformAdministratorUser()
  await legacyReminderRepository.startPrepared()
  refresh()
}

export async function cancelPreparedLegacyReminders() {
  await requirePlatformAdministratorUser()
  await legacyReminderRepository.cancelPrepared()
  refresh()
}

export async function stopUnsentLegacyReminders() {
  await requirePlatformAdministratorUser()
  await legacyReminderRepository.stopUnsent()
  refresh()
}

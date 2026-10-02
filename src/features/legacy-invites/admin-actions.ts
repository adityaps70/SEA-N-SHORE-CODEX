'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { legacyInviteRepository } from './repository'

const batchSchema = z.coerce.number().int().refine((value) => value === 10 || value === 50 || value === 100)

export async function queueLegacyInviteBatch(formData: FormData) {
  const admin = await requirePlatformAdministratorUser()
  const parsed = batchSchema.safeParse(formData.get('limit'))
  if (!parsed.success) throw new Error('legacy_invite_batch_invalid')
  await legacyInviteRepository.queueEligible(parsed.data, admin.id)
  revalidatePath('/admin/legacy-invites')
}

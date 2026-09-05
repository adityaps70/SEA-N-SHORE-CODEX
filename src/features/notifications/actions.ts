'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  markAllNotificationsReadInAurora,
  markNotificationReadInAurora,
} from './repository'

export type NotificationActionResult = { ok: true } | { ok: false; error: string }

const notificationIdSchema = z.string().uuid()

function revalidateNotificationSurfaces() {
  revalidatePath('/notifications')
  revalidatePath('/home')
  revalidatePath('/network')
}

export async function markNotificationRead(id: string): Promise<NotificationActionResult> {
  const parsed = notificationIdSchema.safeParse(id)
  if (!parsed.success) return { ok: false, error: 'Invalid notification.' }

  const user = await requireAwsUser()

  try {
    const updated = await markNotificationReadInAurora(user.id, parsed.data)
    if (!updated) return { ok: false, error: 'We could not update this notification.' }
  } catch {
    return { ok: false, error: 'We could not update this notification.' }
  }

  revalidateNotificationSurfaces()
  return { ok: true }
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  const user = await requireAwsUser()

  try {
    await markAllNotificationsReadInAurora(user.id)
  } catch {
    return { ok: false, error: 'We could not mark your notifications as read.' }
  }

  revalidateNotificationSurfaces()
  return { ok: true }
}

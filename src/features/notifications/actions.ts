'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { userFacingError } from '@/lib/errors/user-messages'
import { getNotificationChrome, getNotifications } from './queries'
import {
  markAllNotificationsReadInAurora,
  markNotificationReadInAurora,
} from './repository'
import type { NetworkNotification, NotificationChrome } from './types'

export type NotificationActionResult = { ok: true } | { ok: false; error: string }
export type NotificationChromeResult = { ok: true; chrome: NotificationChrome } | { ok: false; error: string }
export type NotificationsResult = { ok: true; notifications: NetworkNotification[] } | { ok: false; error: string }

const notificationIdSchema = z.string().uuid()

function revalidateNotificationSurfaces() {
  revalidatePath('/notifications')
  revalidatePath('/home')
  revalidatePath('/network')
}

export async function loadNotificationChrome(): Promise<NotificationChromeResult> {
  try {
    return { ok: true, chrome: await getNotificationChrome() }
  } catch {
    return { ok: false, error: 'We could not refresh your notifications. They will update again shortly.' }
  }
}

export async function loadNotifications(): Promise<NotificationsResult> {
  try {
    return { ok: true, notifications: await getNotifications() }
  } catch {
    return { ok: false, error: 'We could not refresh your notifications.' }
  }
}

export async function markNotificationRead(id: string): Promise<NotificationActionResult> {
  const parsed = notificationIdSchema.safeParse(id)
  if (!parsed.success) return { ok: false, error: 'Invalid notification.' }

  try {
    const user = await requireAwsUser()
    const updated = await markNotificationReadInAurora(user.id, parsed.data)
    if (!updated) return { ok: false, error: 'This notification is no longer available. Refresh the page to see your latest notifications.' }
  } catch (error) {
    return { ok: false, error: userFacingError(error, 'We could not update this notification. Please try again.') }
  }

  revalidateNotificationSurfaces()
  return { ok: true }
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  try {
    const user = await requireAwsUser()
    await markAllNotificationsReadInAurora(user.id)
  } catch (error) {
    return { ok: false, error: userFacingError(error, 'We could not mark your notifications as read. Please try again.') }
  }

  revalidateNotificationSurfaces()
  return { ok: true }
}

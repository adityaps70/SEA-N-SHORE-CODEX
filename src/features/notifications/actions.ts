'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireUser } from '@/features/auth/queries'
import { createServerSupabaseClient } from '@/lib/supabase/server'

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

  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('id', parsed.data)
    .eq('recipient_id', user.id)

  if (error) return { ok: false, error: 'We could not update this notification.' }
  revalidateNotificationSurfaces()
  return { ok: true }
}

export async function markAllNotificationsRead(): Promise<NotificationActionResult> {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase
    .from('notifications')
    .update({ read_at: new Date().toISOString() })
    .eq('recipient_id', user.id)
    .is('read_at', null)

  if (error) return { ok: false, error: 'We could not mark your notifications as read.' }
  revalidateNotificationSurfaces()
  return { ok: true }
}

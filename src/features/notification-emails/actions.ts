'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { isNotificationEmailKind } from './kinds'
import { createNotificationEmailPreferences, unsubscribeWithNotificationEmailToken } from './preferences'

const preferences = createNotificationEmailPreferences()

/** Settings › Email notifications: one activity email type on or off for the signed-in member. */
export async function setNotificationEmailPreference(kind: string, enabled: boolean): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> {
  if (!isNotificationEmailKind(kind) || typeof enabled !== 'boolean') return { ok: false, error: 'Choose on or off.' }
  const user = await requireAwsUser()
  try {
    const saved = await preferences.set(user.id, kind, enabled)
    if (!saved) return { ok: false, error: 'Your email setting could not be saved. Please try again.' }
  } catch {
    return { ok: false, error: 'Your email setting could not be saved. Please try again.' }
  }
  revalidatePath('/settings/notifications')
  return { ok: true, enabled }
}

/** The unsubscribe page's button: turns off the one email type the signed link names. No sign-in needed. */
export async function unsubscribeFromNotificationEmail(token: string): Promise<{ ok: boolean }> {
  if (typeof token !== 'string') return { ok: false }
  try {
    const result = await unsubscribeWithNotificationEmailToken(token)
    return { ok: result.ok }
  } catch {
    return { ok: false }
  }
}

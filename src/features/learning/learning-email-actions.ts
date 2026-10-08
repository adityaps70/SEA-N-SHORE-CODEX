'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { createLearningEmailPreferences } from './learning-email-sending'

const preferences = createLearningEmailPreferences()

/** Settings → Email notifications: learning emails on or off for the signed-in member. */
export async function setLearningEmailPreference(enabled: boolean): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> {
  if (typeof enabled !== 'boolean') return { ok: false, error: 'Choose on or off.' }
  const user = await requireAwsUser()
  try {
    await preferences.setLearningEmails(user.id, enabled)
  } catch {
    return { ok: false, error: 'Your email setting could not be saved. Please try again.' }
  }
  revalidatePath('/settings/notifications')
  return { ok: true, enabled }
}

/** The unsubscribe page's button: turns learning emails off for the person the email went to. */
export async function unsubscribeFromLearningEmails(token: string): Promise<{ ok: boolean }> {
  if (typeof token !== 'string') return { ok: false }
  try {
    return { ok: await preferences.unsubscribeWithToken(token) }
  } catch {
    return { ok: false }
  }
}

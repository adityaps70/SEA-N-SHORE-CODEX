'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { RANKING_EMAIL_TOPICS, type RankingEmailTopic } from './ranking-email'
import { createRankingEmailPreferences } from './ranking-email-sending'

const preferences = createRankingEmailPreferences()

function isTopic(value: unknown): value is RankingEmailTopic {
  return (RANKING_EMAIL_TOPICS as readonly unknown[]).includes(value)
}

/** Settings › Email notifications: job alert emails or the weekly digest on or off. */
export async function setRankingEmailTopic(topic: string, enabled: boolean): Promise<{ ok: true; enabled: boolean } | { ok: false; error: string }> {
  if (!isTopic(topic) || typeof enabled !== 'boolean') return { ok: false, error: 'Choose on or off.' }
  const user = await requireAwsUser()
  try {
    await preferences.set(user.id, topic, enabled)
  } catch {
    return { ok: false, error: 'Your email setting could not be saved. Please try again.' }
  }
  revalidatePath('/settings/notifications')
  return { ok: true, enabled }
}

/** The unsubscribe page's button: turns the email's topic off for the person it went to. */
export async function unsubscribeFromRankingEmail(token: string): Promise<{ ok: boolean }> {
  if (typeof token !== 'string') return { ok: false }
  try {
    return { ok: Boolean(await preferences.unsubscribeWithToken(token)) }
  } catch {
    return { ok: false }
  }
}

'use server'

import { legacyReminderRepository } from './reminder-repository'

/** The legacy reminder's unsubscribe page button: puts the address the reminder went to on the do-not-email list. */
export async function unsubscribeFromLegacyReminder(token: string): Promise<{ ok: boolean }> {
  if (typeof token !== 'string') return { ok: false }
  try {
    return { ok: await legacyReminderRepository.unsubscribeWithToken(token) }
  } catch {
    return { ok: false }
  }
}

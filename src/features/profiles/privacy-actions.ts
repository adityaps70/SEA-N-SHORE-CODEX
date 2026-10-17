'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { query } from '@/lib/db/client'
import { CONNECTIONS_VISIBILITIES, MESSAGE_PERMISSIONS } from './privacy-choices'
import { canBeOpenToRecruiters, privacyPreferences, type PrivacyChoiceKey, type PrivacyPreferenceKey } from './privacy-preferences'

export type PrivacyActionResult = { ok: true; value: boolean } | { ok: false; error: string }

/** Settings › Privacy: saves one switch as soon as it changes. */
export async function setPrivacyPreference(key: string, value: boolean): Promise<PrivacyActionResult> {
  if ((key !== 'showInPeopleSuggestions' && key !== 'openToRecruiters') || typeof value !== 'boolean') {
    return { ok: false, error: 'Unknown setting.' }
  }
  try {
    const user = await requireAwsUser()
    if (key === 'openToRecruiters' && value) {
      const rows = await query(`select persona from public.profiles where id = $1`, [user.id])
      if (!canBeOpenToRecruiters(rows[0]?.persona as string | null)) {
        return { ok: false, error: 'This setting is for seafarers and shore professionals.' }
      }
    }
    await privacyPreferences.set(user.id, key as PrivacyPreferenceKey, value)
    revalidatePath('/settings/privacy')
    return { ok: true, value }
  } catch {
    return { ok: false, error: 'We could not save this setting. Please try again.' }
  }
}

export type PrivacyChoiceActionResult = { ok: true } | { ok: false; error: string }

/** Round H (H2): saves "Who can message me" or "Who can see my connections" (validated here, enforced where read). */
export async function setPrivacyChoice(key: string, value: string): Promise<PrivacyChoiceActionResult> {
  const valid = key === 'messagePermission'
    ? (MESSAGE_PERMISSIONS as readonly string[]).includes(value)
    : key === 'connectionsVisibility' && (CONNECTIONS_VISIBILITIES as readonly string[]).includes(value)
  if (!valid) return { ok: false, error: 'Unknown setting.' }
  try {
    const user = await requireAwsUser()
    await privacyPreferences.setChoice(user.id, key as PrivacyChoiceKey, value as never)
    revalidatePath('/settings/privacy')
    return { ok: true }
  } catch {
    return { ok: false, error: 'We could not save this setting. Please try again.' }
  }
}

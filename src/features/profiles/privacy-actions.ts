'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { query } from '@/lib/db/client'
import { canBeOpenToRecruiters, privacyPreferences, type PrivacyPreferenceKey } from './privacy-preferences'

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

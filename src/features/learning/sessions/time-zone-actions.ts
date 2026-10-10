'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { memberTimeZoneRepository } from './member-time-zone'
import { isValidTimeZone } from './session-time'

type Result = { ok: true } | { ok: false; error: string }

/** Settings: "Automatic (this device)" or a chosen zone for session emails. */
export async function saveTimeZoneAction(source: 'auto' | 'manual', timeZone: string | null): Promise<Result> {
  if (source !== 'auto' && source !== 'manual') return { ok: false, error: 'Choose Automatic or a time zone.' }
  if (source === 'manual' && !isValidTimeZone(timeZone)) return { ok: false, error: 'Choose a time zone from the list.' }
  try {
    const user = await requireAwsUser()
    await memberTimeZoneRepository.save(user.id, { source, timeZone: timeZone && isValidTimeZone(timeZone) ? timeZone : null })
    revalidatePath('/settings/notifications')
    return { ok: true }
  } catch {
    return { ok: false, error: 'We could not save your time zone. Please try again.' }
  }
}

/** Called quietly from learning pages: keeps an "Automatic" member's email time zone in step with their device. */
export async function syncDeviceTimeZoneAction(deviceZone: string): Promise<{ ok: boolean }> {
  if (!isValidTimeZone(deviceZone)) return { ok: false }
  try {
    const user = await requireAwsUser()
    return { ok: await memberTimeZoneRepository.syncDevice(user.id, deviceZone) }
  } catch {
    return { ok: false }
  }
}

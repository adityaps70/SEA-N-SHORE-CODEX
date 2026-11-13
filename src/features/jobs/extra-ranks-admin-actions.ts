'use server'

import { redirect } from 'next/navigation'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { departmentByKey, roleByKey } from '@/features/roles/taxonomy'
import { extraRanksRepository } from './extra-ranks-repository'

/**
 * P6: Admin › Jobs › Extra ranks. Hide (or show again) a rank another department's posters added, so it stops (or
 * starts again) appearing as a tick box on that department's job form. Jobs already posted keep their ranks.
 * Requires a platform administrator (with admin two-step verification); comes back with ?notice= or ?error=.
 */
const PAGE = '/admin/jobs/ranks'

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`)
}

export async function setJobExtraRankHidden(formData: FormData) {
  let admin: { id: string } | null = null
  try {
    admin = await requirePlatformAdministratorUser()
  } catch {
    admin = null
  }
  if (!admin) back({ error: 'forbidden' })

  const departmentKey = formData.get('departmentKey')?.toString() ?? ''
  const roleKey = formData.get('roleKey')?.toString() ?? ''
  const hidden = formData.get('hidden')?.toString() === 'true'
  if (!departmentByKey(departmentKey) || !roleByKey(roleKey)) back({ error: 'not_found' })

  let changed = false
  try {
    changed = await extraRanksRepository.setHidden(admin.id, departmentKey, roleKey, hidden)
  } catch {
    back({ error: 'failed' })
  }
  if (!changed) back({ error: 'not_found' })
  back({ notice: hidden ? 'hidden' : 'shown' })
}

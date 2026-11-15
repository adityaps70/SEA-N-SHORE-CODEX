'use server'

import { redirect } from 'next/navigation'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { adminRanksRepository, type AnchorRelation } from './admin-ranks-repository'
import { ensureRoleCatalog, reloadRoleCatalog } from './catalog-runtime'
import { roleByKey } from './taxonomy'

/**
 * P6b: Admin › Ranks. Add a missing rank to the master list, or hide (show again) one an administrator added. Requires
 * a platform administrator with admin two-step verification; comes back with ?notice= or ?error=. The rank list on
 * this server reloads at once; the other servers pick it up within 30 seconds.
 */
const PAGE = '/admin/ranks'

function back(params: Record<string, string>): never {
  redirect(`${PAGE}?${new URLSearchParams(params).toString()}`)
}

async function administrator() {
  try {
    return await requirePlatformAdministratorUser()
  } catch {
    return null
  }
}

export async function addMasterRank(formData: FormData) {
  const admin = await administrator()
  if (!admin) back({ error: 'forbidden' })
  await ensureRoleCatalog()
  const relation = formData.get('relation')?.toString() ?? ''
  const synonyms = (formData.get('synonyms')?.toString() ?? '').split(',').map((text) => text.trim()).filter(Boolean)
  // The department is the anchor rank's: a new rank always sits on an existing ladder.
  const anchorKey = formData.get('anchorKey')?.toString() ?? ''
  let result: Awaited<ReturnType<typeof adminRanksRepository.addRank>>
  try {
    result = await adminRanksRepository.addRank(admin.id, {
      label: formData.get('label')?.toString() ?? '',
      departmentKey: roleByKey(anchorKey)?.department ?? '',
      anchorKey,
      relation: (['above', 'same', 'below'].includes(relation) ? relation : 'below') as AnchorRelation,
      synonyms,
    })
  } catch {
    back({ error: 'failed' })
  }
  if (result.status === 'error') back({ error: result.error })
  await reloadRoleCatalog()
  back({ notice: 'added', code: result.code })
}

export async function setMasterRankHidden(formData: FormData) {
  const admin = await administrator()
  if (!admin) back({ error: 'forbidden' })
  const code = formData.get('code')?.toString() ?? ''
  const hidden = formData.get('hidden')?.toString() === 'true'
  let changed = false
  try {
    changed = await adminRanksRepository.setHidden(admin.id, code, hidden)
  } catch {
    back({ error: 'failed' })
  }
  if (!changed) back({ error: 'not_found' })
  await reloadRoleCatalog()
  back({ notice: hidden ? 'hidden' : 'shown' })
}

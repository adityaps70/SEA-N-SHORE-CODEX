'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { query } from '@/lib/db/client'
import { isRankingArea, isRankingMode, rankingSwitches } from './switches'

export type RankingSwitchResult = { ok: true } | { ok: false; error: string }

/** Admin › Ranking: turn an area's new ranking off, on for administrators, or on for everyone. Audited. */
export async function setRankingModeAction(area: string, mode: string): Promise<RankingSwitchResult> {
  if (!isRankingArea(area) || !isRankingMode(mode)) return { ok: false, error: 'Unknown switch.' }
  let adminId: string
  try {
    adminId = (await requirePlatformAdministratorUser()).id
  } catch {
    return { ok: false, error: 'Only platform administrators can change ranking switches.' }
  }
  try {
    const previous = await rankingSwitches.modeFor(area)
    await rankingSwitches.setMode(area, mode, adminId)
    await query(
      `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
       values ($1, 'ranking.mode_changed', 'ranking_setting', $2, $3::jsonb)`,
      [adminId, area, JSON.stringify({ from: previous, to: mode })],
    )
  } catch {
    return { ok: false, error: 'The switch could not be saved. Please try again.' }
  }
  revalidatePath('/admin/ranking')
  return { ok: true }
}

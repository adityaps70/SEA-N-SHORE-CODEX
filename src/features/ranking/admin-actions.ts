'use server'

import { revalidatePath } from 'next/cache'
import { requirePlatformAdministratorUser } from '@/features/admin/access'
import { query } from '@/lib/db/client'
import { isRankingArea, isRankingMode, rankingSwitches } from './switches'
import { createJobAlertSender } from './job-alerts'
import { createWeeklyDigest } from './weekly-digest'

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

/** Admin › Ranking: queue a test weekly digest to the signed-in administrator, marked [Test]. */
export async function sendTestDigestAction(): Promise<RankingSwitchResult & { items?: number }> {
  let adminId: string
  try {
    adminId = (await requirePlatformAdministratorUser()).id
  } catch {
    return { ok: false, error: 'Only platform administrators can send test emails.' }
  }
  try {
    const result = await createWeeklyDigest().queueTest(adminId)
    await query(
      `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
       values ($1, 'ranking.test_email_queued', 'ranking_email', 'weekly_digest', $2::jsonb)`,
      [adminId, JSON.stringify({ items: result.items })],
    )
    return { ok: true, items: result.items }
  } catch {
    return { ok: false, error: 'The test digest could not be queued. Is migration 0085 applied?' }
  }
}

/**
 * Admin › Ranking: queue a test job alert email to the signed-in administrator (their first alert,
 * or Jobs for you), so the owner sees a real one before the alerts go to everyone. Marked [Test].
 */
export async function sendTestJobAlertAction(): Promise<RankingSwitchResult & { jobs?: number }> {
  let adminId: string
  try {
    adminId = (await requirePlatformAdministratorUser()).id
  } catch {
    return { ok: false, error: 'Only platform administrators can send test emails.' }
  }
  try {
    const result = await createJobAlertSender().queueTest(adminId)
    await query(
      `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
       values ($1, 'ranking.test_email_queued', 'ranking_email', 'job_alerts', $2::jsonb)`,
      [adminId, JSON.stringify({ jobs: result.jobs })],
    )
    return { ok: true, jobs: result.jobs }
  } catch {
    return { ok: false, error: 'The test email could not be queued. Is migration 0085 applied?' }
  }
}

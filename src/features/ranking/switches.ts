import { query as databaseQuery } from '@/lib/db/client'
import { RANKING_AREAS, isRankingArea, isRankingMode, type RankingArea, type RankingMode } from './switch-areas'

/**
 * Round G: one switch per ranking area, in public.ranking_settings (migration 0083). Each is
 * 'off' (the old behaviour), 'admins' (platform administrators only) or 'everyone'. The app reads
 * the table at most every 30 s per task, so a change on Admin › Ranking applies within 30 s with no
 * deploy. A missing row, a missing table or a failed read all mean 'off'.
 */
export { RANKING_AREAS, RANKING_AREA_LABELS, RANKING_MODES, isRankingArea, isRankingMode } from './switch-areas'
export type { RankingArea, RankingMode } from './switch-areas'

export const RANKING_SETTINGS_TTL_MS = 30_000
const ADMIN_TTL_MS = 60_000

type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export function createRankingSwitches(input: { query?: Query; now?: () => number } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  const now = input.now ?? Date.now
  let cached: { at: number; modes: Map<RankingArea, RankingMode> } | null = null
  let inFlight: Promise<Map<RankingArea, RankingMode>> | null = null
  const adminCache = new Map<string, { at: number; admin: boolean }>()

  async function loadModes(): Promise<Map<RankingArea, RankingMode>> {
    if (cached && now() - cached.at < RANKING_SETTINGS_TTL_MS) return cached.modes
    inFlight ??= (async () => {
      const modes = new Map<RankingArea, RankingMode>()
      try {
        const rows = await queryRows(
          `select key, mode from public.ranking_settings`,
        )
        for (const row of rows) {
          if (isRankingArea(row.key) && isRankingMode(row.mode)) modes.set(row.key, row.mode)
        }
      } catch {
        // Fail closed to the old behaviour; the next read tries again.
        return modes
      }
      cached = { at: now(), modes }
      return modes
    })().finally(() => { inFlight = null })
    return inFlight
  }

  async function modeFor(area: RankingArea): Promise<RankingMode> {
    return (await loadModes()).get(area) ?? 'off'
  }

  async function isAdministrator(profileId: string) {
    const hit = adminCache.get(profileId)
    if (hit && now() - hit.at < ADMIN_TTL_MS) return hit.admin
    let admin = false
    try {
      const rows = await queryRows(
        `select 1 from public.user_roles where user_id = $1 and role::text = 'administrator' limit 1`,
        [profileId],
      )
      admin = rows.length > 0
    } catch {
      admin = false
    }
    if (adminCache.size > 5000) adminCache.clear()
    adminCache.set(profileId, { at: now(), admin })
    return admin
  }

  /** Whether the new ranking for `area` applies to this member. */
  async function isEnabled(area: RankingArea, profileId: string | null | undefined): Promise<boolean> {
    const mode = await modeFor(area)
    if (mode === 'everyone') return true
    if (mode === 'off' || !profileId) return false
    return isAdministrator(profileId)
  }

  async function listModes(): Promise<Record<RankingArea, RankingMode>> {
    const modes = await loadModes()
    return Object.fromEntries(RANKING_AREAS.map((area) => [area, modes.get(area) ?? 'off'])) as Record<RankingArea, RankingMode>
  }

  async function setMode(area: RankingArea, mode: RankingMode, actorId: string) {
    await queryRows(
      `insert into public.ranking_settings (key, mode, updated_at, updated_by)
       values ($1, $2, now(), $3)
       on conflict (key) do update set mode = excluded.mode, updated_at = now(), updated_by = excluded.updated_by`,
      [area, mode, actorId],
    )
    cached = null
  }

  return { isEnabled, modeFor, listModes, setMode, isAdministrator, clear: () => { cached = null; adminCache.clear() } }
}

export const rankingSwitches = createRankingSwitches()
export const isRankingEnabled = rankingSwitches.isEnabled

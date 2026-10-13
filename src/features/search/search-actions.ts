'use server'

import { requireAwsUser } from '@/features/auth/aws-queries'
import { isRankingEnabled } from '@/features/ranking/switches'
import { searchLog } from './search-log'
import { SEARCH_KINDS } from './search-weights'

/** Round G (G4): the member's recent searches for the empty search box (none when search v2 is off). */
export async function getRecentSearchesAction(): Promise<string[]> {
  try {
    const user = await requireAwsUser()
    if (!await isRankingEnabled('search', user.id)) return []
    return await searchLog.recent(user.id)
  } catch {
    return []
  }
}

export async function clearRecentSearchesAction(): Promise<{ ok: boolean }> {
  try {
    const user = await requireAwsUser()
    await searchLog.clear(user.id)
    return { ok: true }
  } catch {
    return { ok: false }
  }
}

/** A committed search: Enter, "See all results", or opening a result (never each keystroke). */
export async function recordSearchAction(query: string, resultCount: number, clickedKind: string | null = null): Promise<void> {
  if (typeof query !== 'string' || !query.trim() || query.length > 80) return
  try {
    const user = await requireAwsUser()
    const kind = clickedKind && (SEARCH_KINDS as readonly string[]).includes(clickedKind) ? clickedKind : null
    await searchLog.record(user.id, query, { resultCount: Number.isFinite(resultCount) ? resultCount : 0, clickedKind: kind })
  } catch {
    // Best effort: a lost log line never affects the search.
  }
}

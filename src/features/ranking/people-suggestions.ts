import { createProfileRepository } from '@/features/profiles/repository'
import { DECLINED_REQUEST_SUGGESTION_WINDOW, RECOMMENDATION_WEIGHTS } from '@/features/network/recommendations'
import { normaliseTaxonomyText } from '@/features/taxonomy/maritime-taxonomy'
import { createPeopleCandidateRepository, peopleCandidateRepository } from './people-candidates'
import { PEOPLE_WEIGHTS } from './people-weights'
import { diversifyPeople, reasonText, scorePeopleCandidate, type PeopleSection, type StoredReason } from './people-scorer'

/**
 * Round G (G2): People you may know, precomputed into people_suggestions (nightly, and for one
 * member right after they connect, finish onboarding or change company or rank). Reads re-check
 * every exclusion live, apply the top-5 diversity rule, and always fill the requested number: when
 * the precomputed rows run out, live profile-match scoring tops the list up.
 */
type CandidateRepository = ReturnType<typeof createPeopleCandidateRepository>
type ProfileRepository = ReturnType<typeof createProfileRepository>

export type PeopleSuggestion = { candidateId: string; reason: string | null; source: string }

/**
 * Round DB (PYMK fix 2, owner-approved 12 Nov): the live top-up scored every member on every list view (the
 * night re-test: 1,376 runs in 50 minutes, 17 ms and 7,300 buffer reads each). Its result is now kept per
 * member for 10 minutes as a list of ids, a few deeper than asked. Each view re-runs the same query over only
 * those ids, so every eligibility rule and exclusion (connections and requests either way, follows, blocks
 * either way, recent declines, dismissals, opt-outs, inactive, removed, not onboarded, organisations,
 * load-test and synthetic accounts) is applied now, exactly as before. When the kept ids can no longer fill
 * the list, it is scored afresh. A member who becomes newly eligible appears in others' top-ups within 10
 * minutes; nobody excluded ever does.
 */
export const PEOPLE_TOP_UP_CACHE_MS = 10 * 60 * 1000
export const PEOPLE_TOP_UP_SPARE = 6
export const PEOPLE_TOP_UP_CACHE_ENTRIES = 5000

type TopUpEntry = { at: number; depth: number; ids: string[] }

export function createPeopleSuggestions(input: {
  candidates?: CandidateRepository
  profiles?: ProfileRepository
  now?: () => number
  topUpCacheMs?: number
} = {}) {
  const candidates = input.candidates ?? peopleCandidateRepository
  const profiles = input.profiles ?? createProfileRepository()
  const now = input.now ?? Date.now
  const topUpCacheMs = input.topUpCacheMs ?? PEOPLE_TOP_UP_CACHE_MS
  const topUps = new Map<string, TopUpEntry>()

  /** The live profile-match top-up, in score order: at least `wanted` long whenever that many are eligible. */
  async function liveTopUp(viewerId: string, wanted: number) {
    const base = {
      viewerProfileId: viewerId,
      weights: RECOMMENDATION_WEIGHTS,
      declinedRequestWindow: DECLINED_REQUEST_SUGGESTION_WINDOW,
      roundG: true,
    }
    const kept = topUps.get(viewerId)
    if (kept && now() - kept.at < topUpCacheMs && kept.depth >= wanted) {
      const rechecked = await profiles.getPeopleSuggestions({ ...base, limit: kept.depth, onlyIds: kept.ids })
      // Enough left, or nobody else was eligible when they were kept: the kept list still answers.
      if (rechecked.length >= wanted || kept.ids.length < kept.depth) return rechecked
    }
    const depth = Math.min(60, wanted + PEOPLE_TOP_UP_SPARE)
    const fresh = await profiles.getPeopleSuggestions({ ...base, limit: depth })
    topUps.delete(viewerId)
    topUps.set(viewerId, { at: now(), depth, ids: fresh.map((profile) => profile.id) })
    while (topUps.size > PEOPLE_TOP_UP_CACHE_ENTRIES) topUps.delete(topUps.keys().next().value as string)
    return fresh
  }

  /** Recomputes one member's rows. Returns how many were stored. */
  async function refreshForViewer(viewerId: string) {
    const viewer = await candidates.getViewer(viewerId)
    if (!viewer) return 0
    const scored = (await candidates.listCandidates(viewerId))
      .map((candidate) => scorePeopleCandidate(candidate, viewer))
      .filter((entry) => entry.score >= PEOPLE_WEIGHTS.minScore)
      .sort((left, right) => right.score - left.score)
      .slice(0, PEOPLE_WEIGHTS.keepPerViewer)
    await candidates.replaceSuggestions(viewerId, scored.map((entry) => ({
      candidateId: entry.item.candidateId,
      score: entry.score,
      primarySource: entry.primarySource,
      reasons: entry.stored,
    })))
    return scored.length
  }

  /** Best effort: a failed refresh is logged without ids and never breaks the member's action. */
  async function refreshQuietly(viewerId: string) {
    try {
      await refreshForViewer(viewerId)
    } catch (error) {
      console.warn('[people_suggestions_refresh_failed]', { code: (error as { code?: string })?.code ?? null })
    }
  }

  async function list(viewerId: string, options: { limit: number; section?: PeopleSection | null }): Promise<PeopleSuggestion[]> {
    const limit = Math.max(1, Math.min(options.limit, 60))
    const stored = await candidates.listStored(viewerId, { limit: Math.min(limit * 2, 120), ...(options.section ? { section: options.section } : {}) })
    const ordered = diversifyPeople(stored.map((row) => ({
      ...row,
      companyKey: row.companyId ?? (row.companyName ? normaliseTaxonomyText(row.companyName) : null),
    })))
    const picked: PeopleSuggestion[] = ordered.slice(0, limit).map((row) => ({
      candidateId: row.candidateId,
      reason: row.reasons[0] ? reasonText(row.reasons[0] as StoredReason) : null,
      source: row.primarySource,
    }))
    // A section ("See all") lists only its own source; the general list is always topped up.
    if (picked.length >= limit || options.section) return picked
    const chosen = new Set(picked.map((item) => item.candidateId))
    const live = await liveTopUp(viewerId, limit + chosen.size)
    for (const profile of live) {
      if (picked.length >= limit) break
      if (chosen.has(profile.id)) continue
      picked.push({ candidateId: profile.id, reason: null, source: 'profile' })
    }
    return picked
  }

  return { refreshForViewer, refreshQuietly, list, removePair: candidates.removePair }
}

export const peopleSuggestions = createPeopleSuggestions()

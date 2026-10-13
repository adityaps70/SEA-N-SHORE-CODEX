import { randomUUID } from 'node:crypto'
import { createFeedCandidateRepository, feedCandidateRepository, type FeedCandidate, type FeedViewerProfile } from './feed-candidates'
import { collapseReposts, diversify, isColdStart, pinOwnRecentPosts, scoreFeedCandidate, type RankedFeedEntry } from './feed-scorer'
import { createFeedSessionRepository, feedSessionRepository, type FeedSession, type FeedSessionMeta, type FeedSessionStage } from './feed-sessions'
import { FEED_WEIGHTS, FEED_WEIGHTS_VERSION } from './feed-weights'

/**
 * Round G (G1): "Top for you". Ranks once per visit into a snapshot (feed_sessions); a cursor is a
 * position in it.
 *
 * NO REPEATS: the candidate query excludes everything the viewer has seen (impressions) or engaged
 * with, server-side, so a reload, a new tab or another device never brings a seen post back. Inside
 * one visit, a new snapshot also leaves out everything already served. When nothing unseen is left
 * in the ranked windows (7 → 14 → 30 days), it tries 90 and 180 days, then a weighted-random mix of
 * posts from outside the viewer's network, then reports "caught up".
 */
type CandidateRepository = ReturnType<typeof createFeedCandidateRepository>
type SessionRepository = ReturnType<typeof createFeedSessionRepository>

export type TopFeedPageResult = {
  session: FeedSession
  postIds: string[]
  nextPosition: number | null
  caughtUp: boolean
}

/** Deterministic PRNG for the explore shuffle: a different order per visit, the same within one. */
function seededRandom(seed: string) {
  let state = 0
  for (let index = 0; index < seed.length; index += 1) state = (Math.imul(31, state) + seed.charCodeAt(index)) | 0
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let value = Math.imul(state ^ (state >>> 15), 1 | state)
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

/** Weighted random order (Efraimidis–Spirakis): higher quality tends to come first, but the order changes per visit. */
export function weightedShuffle<T>(entries: readonly T[], weight: (entry: T) => number, seed: string): T[] {
  const random = seededRandom(seed)
  return entries
    .map((entry) => ({ entry, key: Math.pow(Math.max(random(), 1e-12), 1 / Math.max(weight(entry), 1e-6)) }))
    .sort((left, right) => right.key - left.key)
    .map(({ entry }) => entry)
}

export function createTopFeed(input: {
  candidates?: CandidateRepository
  sessions?: SessionRepository
  now?: () => Date
} = {}) {
  const candidates = input.candidates ?? feedCandidateRepository
  const sessions = input.sessions ?? feedSessionRepository
  const now = input.now ?? (() => new Date())

  function rank(list: readonly FeedCandidate[], viewer: FeedViewerProfile, demoted: ReadonlySet<string>): RankedFeedEntry[] {
    const at = now()
    const scored = list.map((candidate) => {
      const entry = scoreFeedCandidate(candidate, { viewer, now: at })
      if (!demoted.has(candidate.contentId)) return entry
      return { ...entry, score: entry.score * FEED_WEIGHTS.penalties.servedNotSeen, parts: { ...entry.parts, servedNotSeen: FEED_WEIGHTS.penalties.servedNotSeen } }
    })
    const ordered = pinOwnRecentPosts(diversify(collapseReposts(scored)), at)
    // A post served last visit but not seen never comes back near the top.
    const floor = FEED_WEIGHTS.penalties.servedNotSeenFloorPosition
    const top = ordered.slice(0, floor)
    const moved = top.filter((entry) => demoted.has(entry.item.contentId))
    if (!moved.length) return ordered
    const keep = top.filter((entry) => !demoted.has(entry.item.contentId))
    return [...keep, ...ordered.slice(floor, floor + moved.length), ...moved, ...ordered.slice(floor + moved.length)]
  }

  function sessionMeta(entries: readonly RankedFeedEntry[], coldStart: boolean): FeedSessionMeta {
    return {
      version: FEED_WEIGHTS_VERSION,
      coldStart,
      entries: Object.fromEntries(entries.map((entry) => [entry.item.id, {
        reasons: entry.reasons.map((reason) => reason.text),
        repostedBy: entry.repostedBy,
        debug: { score: entry.score, parts: entry.parts },
      }])),
    }
  }

  async function buildSnapshot(viewerId: string, visitId: string, exclude: readonly string[], demoted: ReadonlySet<string>): Promise<FeedSession> {
    const viewer = await candidates.getViewerProfile(viewerId)
    const coldStart = viewer ? isColdStart(viewer) : true
    const profile: FeedViewerProfile = viewer ?? {
      id: viewerId, roleKey: null, departmentKey: null, persona: null, intents: [], vesselCodes: [], tradingAreas: [],
      companyId: null, createdAt: null, graphSize: 0, engagementCount: 0, categoryAffinity: {},
    }
    const size = FEED_WEIGHTS.session.snapshotSize
    let stage: FeedSessionStage = 'ranked'
    let entries: RankedFeedEntry[] = []

    for (const windowDays of FEED_WEIGHTS.candidates.windowsDays) {
      let list = await candidates.listCandidates({ viewerId, windowDays, excludeContentIds: exclude })
      if (coldStart) {
        // Cold start: a discovery-heavy mix from outside the (small) network.
        const explore = await candidates.listCandidates({ viewerId, windowDays: Math.max(windowDays, 30), excludeContentIds: exclude, mode: 'explore', limit: 200 })
        const known = new Set(list.map((candidate) => candidate.id))
        list = [...list, ...explore.filter((candidate) => !known.has(candidate.id))]
      }
      entries = rank(list, profile, demoted)
      if (list.length >= FEED_WEIGHTS.candidates.minCandidates) break
    }

    if (!entries.length) {
      stage = 'wider'
      for (const windowDays of FEED_WEIGHTS.candidates.fallbackWindowsDays) {
        entries = rank(await candidates.listCandidates({ viewerId, windowDays, excludeContentIds: exclude }), profile, demoted)
        if (entries.length) break
      }
    }

    if (!entries.length) {
      stage = 'explore'
      const explore = await candidates.listCandidates({ viewerId, windowDays: 180, excludeContentIds: exclude, mode: 'explore' })
      const scored = collapseReposts(explore.map((candidate) => scoreFeedCandidate(candidate, { viewer: profile, now: now() })))
      entries = weightedShuffle(scored, (entry) => (entry.parts.engagement ?? 1) * (entry.parts.penalty ?? 1), visitId)
        .map((entry) => ({ ...entry, reasons: [{ code: 'explore', text: 'From outside your network, chosen for you' }] }))
    }

    if (!entries.length) stage = 'caught_up'
    const kept = entries.slice(0, size)
    return sessions.create({ viewerId, visitId, postIds: kept.map((entry) => entry.item.id), meta: sessionMeta(kept, coldStart), stage })
  }

  /**
   * One page of "Top for you". No cursor: a new visit (a reload or refresh) with a new snapshot that
   * leaves out everything seen so far. With a cursor: the next positions of that snapshot; when it
   * runs out or expires, a new snapshot for the same visit that leaves out what was already served.
   */
  async function page(request: { viewerId: string; sessionId?: string; position?: number; pageSize?: number }): Promise<TopFeedPageResult> {
    const pageSize = request.pageSize ?? FEED_WEIGHTS.session.pageSize
    let session: FeedSession | null = request.sessionId ? await sessions.get(request.viewerId, request.sessionId) : null
    let position = Math.max(0, request.position ?? 0)

    if (!session) {
      const visitId = randomUUID()
      const demoted = new Set(await sessions.servedNotSeenContentIds(request.viewerId, visitId))
      session = await buildSnapshot(request.viewerId, visitId, [], demoted)
      position = 0
    } else if (position >= session.postIds.length || session.expiresAt.getTime() < now().getTime()) {
      if (session.stage === 'caught_up') return { session, postIds: [], nextPosition: null, caughtUp: true }
      const exhausted = position >= session.postIds.length
      const exclude = exhausted
        ? await sessions.snapshotContentIds(request.viewerId, session.visitId)
        : await sessions.servedContentIds(request.viewerId, session.visitId)
      session = await buildSnapshot(request.viewerId, session.visitId, exclude, new Set())
      position = 0
    }

    const postIds = session.postIds.slice(position, position + pageSize)
    if (postIds.length) await sessions.markServed(session.id, position + postIds.length)
    const caughtUp = !postIds.length
    return { session, postIds, nextPosition: caughtUp ? null : position + postIds.length, caughtUp }
  }

  return { page, buildSnapshot }
}

export const topFeed = createTopFeed()

import { roleByKey } from '@/features/roles/taxonomy'
import { rankDepartmentGroup, rankDistance, vesselGroupsOf } from '@/features/taxonomy/maritime-taxonomy'
import type { FeedCandidate, FeedViewerProfile } from './feed-candidates'
import { FEED_WEIGHTS, FEED_WEIGHTS_VERSION } from './feed-weights'
import { roundScore, type RankReason, type Scored } from './types'

/**
 * Round G (G1): the "Top for you" scorer. Pure: candidates and the viewer in, scores and reasons out.
 *
 * Score = relationship × (0.6 + relevance) × engagement quality × freshness × penalties
 */
const W = FEED_WEIGHTS

const CATEGORY_LABELS: Record<string, string> = {
  maritime_news: 'Maritime news',
  technical_discussion: 'Technical discussion',
  vetting_sire_2_0: 'Vetting and SIRE 2.0',
  career_advice: 'Career advice',
  safety_lessons: 'Safety lessons',
  achievement: 'Achievements',
  learning: 'Learning',
  industry_opinion: 'Industry opinion',
}

/** "Second Officer" → "Second Officers"; "Master / Captain" → "Masters". For the "Popular with …" line. */
export function rankPlural(roleKey: string | null | undefined) {
  const label = roleByKey(roleKey)?.label
  if (!label || roleByKey(roleKey)?.other) return null
  const base = label.split(/\s+\/\s+|\s+\(/)[0]!.trim()
  return /s$/i.test(base) ? base : `${base}s`
}

function relationship(candidate: FeedCandidate) {
  const r = W.relationship
  if (candidate.isConnection) return { value: r.connection, code: 'connection' }
  if (candidate.isFollowedPerson) return { value: r.followedPerson, code: 'followed_person' }
  if (candidate.isFollowedOrg) return { value: r.followedOrg, code: 'followed_org' }
  if (candidate.isMyCommunity) return { value: r.community, code: 'community' }
  if (candidate.secondDegree) return { value: r.secondDegree, code: 'second_degree' }
  return { value: r.discovery, code: 'discovery' }
}

function overlaps(left: readonly string[], right: readonly string[]) {
  if (!left.length || !right.length) return false
  const set = new Set(left.map((value) => value.toLocaleLowerCase()))
  return right.some((value) => set.has(value.toLocaleLowerCase()))
}

export type FeedScoreContext = {
  viewer: FeedViewerProfile
  now: Date
}

export function scoreFeedCandidate(candidate: FeedCandidate, context: FeedScoreContext): Scored<FeedCandidate> {
  const { viewer, now } = context
  const parts: Record<string, number> = {}
  const reasons: RankReason[] = []

  // Relationship, plus a bonus for authors the viewer engaged with recently.
  const rel = relationship(candidate)
  const engagementBonus = Math.min(W.relationship.recentEngagementMax, W.relationship.recentEngagementPerAction * candidate.viewerEngagementWithAuthor)
  parts.relationship = rel.value + engagementBonus

  // Relevance, capped.
  let relevance = 0
  const affinityTotal = Object.values(viewer.categoryAffinity).reduce((sum, value) => sum + value, 0)
  if (affinityTotal >= 3) {
    relevance += W.relevance.categoryAffinityMax * ((viewer.categoryAffinity[candidate.category] ?? 0) / affinityTotal)
  }
  const distance = rankDistance(viewer.roleKey, candidate.authorRoleKey)
  const sameDepartment = Boolean(viewer.departmentKey && viewer.departmentKey === candidate.authorDepartmentKey)
    || Boolean(viewer.roleKey && candidate.authorRoleKey && rankDepartmentGroup(viewer.roleKey) !== 'shore' && rankDepartmentGroup(viewer.roleKey) === rankDepartmentGroup(candidate.authorRoleKey))
  if ((distance !== null && distance <= 1) || sameDepartment) relevance += W.relevance.sameDepartmentOrRankBand
  const viewerGroups = vesselGroupsOf(viewer.vesselCodes)
  const authorGroups = vesselGroupsOf(candidate.authorVesselCodes)
  if (overlaps(viewerGroups, authorGroups)) relevance += W.relevance.sameVesselGroup
  if (overlaps(viewer.tradingAreas, candidate.authorTradingAreas)) relevance += W.relevance.sameTradingArea
  const sameCompany = Boolean(viewer.companyId && (viewer.companyId === candidate.authorCompanyId || viewer.companyId === candidate.companyId))
  if (sameCompany) relevance += W.relevance.sameCompany
  if (candidate.category === 'learning' && viewer.persona === 'student_cadet') relevance += W.relevance.learningForStudents
  relevance = Math.min(W.relevance.max, relevance)
  parts.relevance = relevance

  // Engagement quality: smoothed, weighted engagement per hour, log-scaled and capped.
  const ageHours = Math.max(0, (now.getTime() - candidate.createdAt.getTime()) / 3_600_000)
  const e = W.engagement
  const weighted = candidate.reactions * e.reactionWeight + candidate.comments * e.commentWeight + candidate.reposts * e.repostWeight
    + candidate.connectionEngagement * (e.connectionMultiplier - 1)
  const rate = (weighted + e.prior) / (ageHours + e.smoothingHours)
  parts.engagement = Math.min(e.cap, 1 + e.logScale * Math.log1p(rate))

  // Freshness: half-life 24 h, with a floor so a strong older post from someone close can still show.
  const close = candidate.isConnection || candidate.isFollowedPerson
  parts.freshness = Math.max(close ? W.freshness.closeFloor : W.freshness.otherFloor, 0.5 ** (ageHours / W.freshness.halfLifeHours))

  // Penalties.
  let penalty = 1
  if (candidate.showLessAuthor || candidate.showLessCompany || candidate.showLessCategory) penalty *= W.penalties.showLess
  if (candidate.pendingReport) penalty *= W.penalties.pendingReport
  if (candidate.authorAccountAgeDays < W.penalties.newAccountDays && (candidate.linkOnly || candidate.authorPostsLastDay > W.penalties.newAccountPostsPerDay)) {
    penalty *= W.penalties.newAccountSpam
  }
  const empty = candidate.bodyLength === 0 && !candidate.hasMedia && candidate.postType === 'standard'
  if (candidate.linkOnly || empty) penalty *= W.penalties.linkOnlyOrEmpty
  parts.penalty = penalty

  const score = parts.relationship * (0.6 + parts.relevance) * parts.engagement * parts.freshness * parts.penalty

  // Reasons: plain, and only what the viewer can already see.
  switch (rel.code) {
    case 'connection':
      reasons.push({ code: 'connection', text: `${candidate.authorName} is your connection` })
      break
    case 'followed_person':
      reasons.push({ code: 'followed_person', text: `You follow ${candidate.authorName}` })
      break
    case 'followed_org':
      reasons.push({ code: 'followed_org', text: `From ${candidate.companyName ?? 'an organization'}, which you follow` })
      break
    case 'community':
      reasons.push({ code: 'community', text: `Posted in ${candidate.groupName ?? 'a community'}, a community you're in` })
      break
    case 'second_degree':
      reasons.push({ code: 'second_degree', text: `${candidate.secondDegreeActorName ?? 'One of your connections'}, your connection, joined the conversation` })
      break
    default: {
      const plural = rankPlural(viewer.roleKey)
      if (candidate.similarEngagement >= 2 && plural) {
        reasons.push({ code: 'popular_with_rank', text: `Popular with ${plural} this week` })
      } else if (candidate.reactions + candidate.comments >= 5) {
        reasons.push({ code: 'popular', text: `Popular in ${CATEGORY_LABELS[candidate.category] ?? 'the community'} this week` })
      } else {
        reasons.push({ code: 'discovery', text: 'Suggested from people in your part of the industry' })
      }
    }
  }
  if (engagementBonus > 0 && rel.code !== 'discovery') reasons.push({ code: 'engaged_author', text: `You often engage with ${candidate.authorName}` })
  else if (sameCompany) reasons.push({ code: 'same_company', text: 'From someone at your company' })
  else if (candidate.connectionEngagement >= 2 && rel.code !== 'second_degree') reasons.push({ code: 'connections_engaged', text: `${candidate.connectionEngagement} of your connections engaged with this` })

  return { item: candidate, score: roundScore(score, 6), reasons: reasons.slice(0, 2), parts: Object.fromEntries(Object.entries(parts).map(([key, value]) => [key, roundScore(value)])) }
}

export type RankedFeedEntry = Scored<FeedCandidate> & {
  /** Collapsed reposts of the same content: the closest reposter and how many others. */
  repostedBy: { actorName: string; others: number } | null
}

/**
 * One card per piece of content: a repost and its original collapse to the best-scoring row, labelled
 * "<connection> and N others reposted" with the reposter closest to the viewer.
 */
export function collapseReposts(scored: readonly Scored<FeedCandidate>[]): RankedFeedEntry[] {
  const groups = new Map<string, Scored<FeedCandidate>[]>()
  for (const entry of scored) {
    const list = groups.get(entry.item.contentId) ?? []
    list.push(entry)
    groups.set(entry.item.contentId, list)
  }
  const result: RankedFeedEntry[] = []
  for (const list of groups.values()) {
    const best = [...list].sort((left, right) => right.score - left.score)[0]!
    const reposters = list
      .filter((entry) => entry.item.repostOfPostId)
      .sort((left, right) => relationship(right.item).value - relationship(left.item).value)
    const closest = reposters[0]
    const totalReposts = Math.max(reposters.length, ...list.map((entry) => entry.item.repostCount))
    result.push({
      ...best,
      repostedBy: closest ? { actorName: closest.item.authorName, others: Math.max(0, totalReposts - 1) } : null,
    })
  }
  return result
}

/**
 * Diversity after scoring: at most 2 posts per author (or organization) in any 10, never two in a
 * row, at most 3 of the same category in a row. Greedy by score. The author rules are hard: a post
 * that cannot be placed without breaking them is left out of this snapshot (it stays unseen, so a
 * later snapshot can show it). Only the category rule relaxes when nothing else fits.
 */
export function diversify<T extends { score: number; item: { authorId: string; companyId: string | null; category: string } }>(entries: readonly T[]): T[] {
  const remaining = [...entries].sort((left, right) => right.score - left.score)
  const output: T[] = []
  const sourceOf = (entry: T) => entry.item.companyId ? `org:${entry.item.companyId}` : `person:${entry.item.authorId}`
  while (remaining.length) {
    const window = output.slice(-9)
    const last = output.at(-1)
    const lastCategories = output.slice(-W.diversity.maxSameCategoryRun).map((entry) => entry.item.category)
    const authorOk = (entry: T) => {
      const source = sourceOf(entry)
      if (last && sourceOf(last) === source) return false
      return window.filter((other) => sourceOf(other) === source).length < W.diversity.maxPerAuthorPerTen
    }
    const categoryOk = (entry: T) => !(lastCategories.length === W.diversity.maxSameCategoryRun && lastCategories.every((category) => category === entry.item.category))
    let index = remaining.findIndex((entry) => authorOk(entry) && categoryOk(entry))
    if (index === -1) index = remaining.findIndex(authorOk)
    if (index === -1) break
    output.push(remaining.splice(index, 1)[0]!)
  }
  return output
}

/** The member's own post in its first minutes goes first, whatever its score. */
export function pinOwnRecentPosts<T extends { item: FeedCandidate }>(entries: readonly T[], now: Date): T[] {
  const pinMs = W.candidates.ownPostPinMinutes * 60_000
  const pinned = entries.filter((entry) => entry.item.isSelf && now.getTime() - entry.item.createdAt.getTime() <= pinMs)
  if (!pinned.length) return [...entries]
  const pinnedIds = new Set(pinned.map((entry) => entry.item.id))
  return [...pinned.sort((left, right) => right.item.createdAt.getTime() - left.item.createdAt.getTime()), ...entries.filter((entry) => !pinnedIds.has(entry.item.id))]
}

/** Fewer than 5 connections, follows, pages and communities, or no engagement yet. */
export function isColdStart(viewer: FeedViewerProfile) {
  return viewer.graphSize <= W.coldStart.maxGraphSize || viewer.engagementCount === 0
}

export { FEED_WEIGHTS_VERSION }

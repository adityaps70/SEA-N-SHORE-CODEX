import { describe, expect, it } from 'vitest'
import type { FeedCandidate, FeedViewerProfile } from './feed-candidates'
import { collapseReposts, diversify, isColdStart, pinOwnRecentPosts, rankPlural, scoreFeedCandidate } from './feed-scorer'
import { weightedShuffle } from './top-feed'

const NOW = new Date('2026-10-13T12:00:00Z')

function candidate(overrides: Partial<FeedCandidate> = {}): FeedCandidate {
  const id = overrides.id ?? `post-${Math.random()}`
  return {
    id,
    contentId: overrides.contentId ?? id,
    authorId: 'author-1',
    companyId: null,
    groupId: null,
    groupPublic: true,
    category: 'technical_discussion',
    postType: 'standard',
    repostOfPostId: null,
    createdAt: new Date(NOW.getTime() - 2 * 3_600_000),
    bodyLength: 120,
    linkOnly: false,
    hasMedia: false,
    isSelf: false,
    isConnection: false,
    isFollowedPerson: false,
    isFollowedOrg: false,
    isMyCommunity: false,
    secondDegree: false,
    secondDegreeActorId: null,
    authorName: 'Placeholder Author',
    companyName: null,
    groupName: null,
    secondDegreeActorName: null,
    reactions: 0,
    comments: 0,
    reposts: 0,
    connectionEngagement: 0,
    similarEngagement: 0,
    authorRoleKey: null,
    authorDepartmentKey: null,
    authorPersona: null,
    authorVesselCodes: [],
    authorTradingAreas: [],
    authorCompanyId: null,
    authorAccountAgeDays: 400,
    authorPostsLastDay: 1,
    viewerEngagementWithAuthor: 0,
    showLessAuthor: false,
    showLessCompany: false,
    showLessCategory: false,
    pendingReport: false,
    repostCount: 0,
    ...overrides,
  }
}

const viewer: FeedViewerProfile = {
  id: 'viewer', roleKey: 'second_officer', departmentKey: 'deck_officers', persona: 'seafarer', intents: [],
  vesselCodes: ['product_tanker'], tradingAreas: ['Worldwide'], companyId: null, createdAt: null, graphSize: 20,
  engagementCount: 10, categoryAffinity: {},
}

const score = (overrides: Partial<FeedCandidate>) => scoreFeedCandidate(candidate(overrides), { viewer, now: NOW })

describe('feed scorer', () => {
  it('ranks a connection above a followed page above a stranger, all else equal', () => {
    expect(score({ isConnection: true }).score).toBeGreaterThan(score({ isFollowedOrg: true, companyName: 'Placeholder Lines' }).score)
    expect(score({ isFollowedOrg: true }).score).toBeGreaterThan(score({ secondDegree: true }).score)
    expect(score({ secondDegree: true }).score).toBeGreaterThan(score({}).score)
  })

  it('rewards engagement, especially from connections, but caps a viral post', () => {
    const quiet = score({ isConnection: true })
    const busy = score({ isConnection: true, reactions: 30, comments: 10 })
    const viral = score({ isConnection: true, reactions: 50_000, comments: 20_000 })
    expect(busy.score).toBeGreaterThan(quiet.score)
    expect(viral.parts.engagement).toBeLessThanOrEqual(2.5)
    expect(score({ reactions: 4, connectionEngagement: 4 }).score).toBeGreaterThan(score({ reactions: 4 }).score)
  })

  it('decays with age, with a floor for close connections', () => {
    const fresh = score({ isConnection: true })
    const threeDays = score({ isConnection: true, createdAt: new Date(NOW.getTime() - 72 * 3_600_000) })
    expect(fresh.score).toBeGreaterThan(threeDays.score)
    expect(threeDays.parts.freshness).toBeGreaterThanOrEqual(0.25)
    expect(score({ createdAt: new Date(NOW.getTime() - 72 * 3_600_000) }).parts.freshness).toBeLessThan(0.25)
  })

  it('applies penalties for show less, pending reports, link-only posts and new spammy accounts', () => {
    const base = score({ isConnection: true }).score
    expect(score({ isConnection: true, showLessAuthor: true }).score).toBeCloseTo(base * 0.3, 5)
    expect(score({ isConnection: true, pendingReport: true }).score).toBeCloseTo(base * 0.2, 5)
    expect(score({ isConnection: true, linkOnly: true }).score).toBeLessThan(base)
    expect(score({ isConnection: true, authorAccountAgeDays: 2, authorPostsLastDay: 9 }).score).toBeLessThan(base)
  })

  it('explains itself in plain words that only name what the viewer can see', () => {
    expect(score({ isConnection: true }).reasons[0]!.text).toBe('Placeholder Author is your connection')
    expect(score({ isFollowedOrg: true, companyName: 'Placeholder Lines' }).reasons[0]!.text).toBe('From Placeholder Lines, which you follow')
    expect(score({ similarEngagement: 3 }).reasons[0]!.text).toBe('Popular with Second Officers this week')
    expect(rankPlural('master')).toBe('Masters')
    expect(rankPlural('second_engineer')).toBe('Second Engineers')
  })
})

describe('repost collapse, diversity and pinning', () => {
  it('collapses an original and its reposts to one card, naming the closest reposter', () => {
    const original = score({ id: 'orig', contentId: 'orig', repostCount: 3 })
    const byConnection = score({ id: 'r1', contentId: 'orig', repostOfPostId: 'orig', isConnection: true, authorName: 'Placeholder Friend' })
    const byStranger = score({ id: 'r2', contentId: 'orig', repostOfPostId: 'orig', authorName: 'Placeholder Stranger' })
    const collapsed = collapseReposts([original, byConnection, byStranger])
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]!.repostedBy).toEqual({ actorName: 'Placeholder Friend', others: 2 })
  })

  it('never shows the same author twice in a row, at most 2 in 10, and at most 3 of a category in a row', () => {
    const entries = Array.from({ length: 12 }, (_, index) => ({
      score: 100 - index,
      item: { authorId: index < 6 ? 'prolific' : `author-${index}`, companyId: null, category: index < 9 ? 'learning' : 'achievement' },
    }))
    const ordered = diversify(entries)
    for (let index = 1; index < ordered.length; index += 1) {
      expect(ordered[index]!.item.authorId === 'prolific' && ordered[index - 1]!.item.authorId === 'prolific').toBe(false)
    }
    for (let start = 0; start + 10 <= ordered.length; start += 1) {
      expect(ordered.slice(start, start + 10).filter((entry) => entry.item.authorId === 'prolific').length).toBeLessThanOrEqual(2)
    }
    for (let index = 3; index < ordered.length; index += 1) {
      const run = ordered.slice(index - 3, index + 1).map((entry) => entry.item.category)
      if (ordered.slice(index - 3).some((entry) => entry.item.category !== 'learning')) expect(new Set(run).size > 1 || run.length < 4).toBe(true)
    }
    // Posts that cannot be placed without breaking the author rules wait for a later snapshot.
    expect(ordered.length).toBeLessThan(entries.length)
  })

  it('pins the member\'s own post from the last 10 minutes on top', () => {
    const own = score({ id: 'own', isSelf: true, createdAt: new Date(NOW.getTime() - 60_000) })
    const other = score({ id: 'other', isConnection: true, reactions: 100 })
    expect(pinOwnRecentPosts([other, own], NOW).map((entry) => entry.item.id)).toEqual(['own', 'other'])
  })

  it('shuffles explore posts differently per visit, the same within one', () => {
    const items = Array.from({ length: 20 }, (_, index) => index)
    const first = weightedShuffle(items, () => 1, 'visit-a')
    expect(weightedShuffle(items, () => 1, 'visit-a')).toEqual(first)
    expect(weightedShuffle(items, () => 1, 'visit-b')).not.toEqual(first)
  })

  it('detects a cold start', () => {
    expect(isColdStart({ ...viewer, graphSize: 3 })).toBe(true)
    expect(isColdStart({ ...viewer, engagementCount: 0 })).toBe(true)
    expect(isColdStart(viewer)).toBe(false)
  })
})

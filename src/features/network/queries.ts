import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  getAwsNetworkProfiles,
  getAwsOwnProfile,
  getAwsPeopleSuggestions,
  getAwsProfileCards,
  getAwsPublicProfilesByIds,
} from '@/features/profiles/aws-queries'
import { peopleSuggestions as peopleSuggestionService } from '@/features/ranking/people-suggestions'
import { peopleCandidateRepository } from '@/features/ranking/people-candidates'
import type { PeopleSection } from '@/features/ranking/people-scorer'
import { isRankingEnabled } from '@/features/ranking/switches'
import { canMessageMember } from '@/features/profiles/privacy-choices'
import { incrementRankingMetric } from '@/features/signals/repository'
import { networkRepository, type MessageAccess } from './repository'
import { PEOPLE_SUGGESTION_LIMITS, scoreRecommendation } from './recommendations'
import type {
  NetworkConnectionRow,
  NetworkFollowView,
  NetworkHubData,
  NetworkProfile,
  NetworkTab,
  RelationshipState,
} from './types'

export function relationshipFromRows(
  viewerId: string,
  targetId: string,
  followedIds: ReadonlySet<string>,
  connections: readonly NetworkConnectionRow[],
): RelationshipState {
  const connection = connections.find((row) =>
    (row.user_low_id === viewerId && row.user_high_id === targetId)
    || (row.user_high_id === viewerId && row.user_low_id === targetId),
  )

  if (!connection) {
    return { following: followedIds.has(targetId), connection: { kind: 'none', connectionId: null } }
  }

  if (connection.status === 'accepted') {
    return {
      following: followedIds.has(targetId),
      connection: { kind: 'connected', connectionId: connection.id },
    }
  }

  return {
    following: followedIds.has(targetId),
    connection: {
      kind: connection.requested_by === viewerId ? 'outgoing_pending' : 'incoming_pending',
      connectionId: connection.id,
    },
  }
}

export function matchesNetworkSearch(profile: NetworkProfile, query: string) {
  const tokens = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!tokens.length) return true

  const haystack = [
    profile.fullName,
    profile.slug,
    profile.location,
    profile.headline,
    profile.summary,
    profile.rank,
    profile.currentCompany,
    profile.currentVessel,
    ...profile.vesselTypes,
    ...profile.tradingAreas,
    ...profile.skills,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase()

  return tokens.every((token) => haystack.includes(token))
}

function counterpartyId(viewerId: string, row: NetworkConnectionRow) {
  return row.user_low_id === viewerId ? row.user_high_id : row.user_low_id
}

async function loadViewerGraph(viewerId: string) {
  try {
    return await networkRepository.loadViewerGraph(viewerId)
  } catch {
    throw new Error('Unable to load your professional relationships.')
  }
}

function profilesInIdOrder<T extends { id: string }>(profiles: T[], ids: readonly string[]) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]))
  return ids.map((id) => byId.get(id)).filter((profile): profile is T => Boolean(profile))
}

function withRelationship(
  viewerId: string,
  profiles: Awaited<ReturnType<typeof getAwsPublicProfilesByIds>>,
  followedIds: ReadonlySet<string>,
  connections: readonly NetworkConnectionRow[],
): NetworkProfile[] {
  return profiles.map((profile) => ({
    ...profile,
    relationship: relationshipFromRows(viewerId, profile.id, followedIds, connections),
  }))
}

/** Round H (H7): may the viewer message each person? The same rule the messaging service enforces. */
export function withMessageAccess(profiles: NetworkProfile[], access: ReadonlyMap<string, MessageAccess>): NetworkProfile[] {
  return profiles.map((profile) => {
    const entry = access.get(profile.id)
    const connected = profile.relationship.connection.kind === 'connected'
    return {
      ...profile,
      canMessage: entry ? canMessageMember({ permission: entry.permission, connected, blocked: entry.blocked }) : connected,
    }
  })
}

export async function getRelationshipState(targetId: string): Promise<RelationshipState> {
  const user = await requireAwsUser()
  const graph = await loadViewerGraph(user.id)
  return relationshipFromRows(user.id, targetId, graph.followedIds, graph.connections)
}

export async function getNetworkHub(
  tab: NetworkTab,
  searchQuery = '',
  followView: NetworkFollowView = 'following',
): Promise<NetworkHubData> {
  const user = await requireAwsUser()
  const graph = await loadViewerGraph(user.id)
  const pending = graph.connections.filter((connection) => connection.status === 'pending')
  const incomingRequestCount = pending.filter((connection) => connection.requested_by !== user.id).length
  const normalizedSearch = searchQuery.trim()

  if (tab === 'discover' && !normalizedSearch) {
    const profiles = await getPeopleSuggestions(PEOPLE_SUGGESTION_LIMITS.discover)
    return {
      tab,
      profiles,
      receivedRequests: [],
      sentRequests: [],
      incomingRequestCount,
      totalCount: profiles.length,
    }
  }

  if (tab === 'discover') {
    // A search on Discover (and the search page's People results) finds anyone, connections included.
    const [viewer, candidates] = await Promise.all([
      getAwsOwnProfile(),
      getAwsNetworkProfiles(60, normalizedSearch),
    ])
    if (!viewer) throw new Error('Complete your professional profile to discover the network.')

    const ranked = candidates
      .map((profile, index) => ({
        profile: {
          ...profile,
          relationship: relationshipFromRows(user.id, profile.id, graph.followedIds, graph.connections),
        } satisfies NetworkProfile,
        score: scoreRecommendation(viewer, profile),
        index,
      }))
      .filter(({ profile }) => normalizedSearch.length > 0 || profile.relationship.connection.kind !== 'connected')
      .filter(({ profile }) => matchesNetworkSearch(profile, normalizedSearch))
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, 30)
      .map(({ profile }) => profile)

    return {
      tab,
      profiles: ranked,
      receivedRequests: [],
      sentRequests: [],
      incomingRequestCount,
      totalCount: ranked.length,
    }
  }

  if (tab === 'connections') {
    const accepted = graph.connections.filter((connection) => connection.status === 'accepted')
    const ids = accepted.map((connection) => counterpartyId(user.id, connection))
    const loaded = await getAwsPublicProfilesByIds(ids)
    const profiles = withRelationship(
      user.id,
      profilesInIdOrder(loaded, ids),
      graph.followedIds,
      graph.connections,
    ).map((profile) => ({
      ...profile,
      relationshipSince: accepted.find((connection) => counterpartyId(user.id, connection) === profile.id)?.updated_at ?? null,
    }))

    return {
      tab,
      profiles: profiles.filter((profile) => matchesNetworkSearch(profile, normalizedSearch)),
      receivedRequests: [],
      sentRequests: [],
      incomingRequestCount,
      totalCount: profiles.length,
    }
  }

  if (tab === 'following') {
    const ids = followView === 'followers'
      ? await networkRepository.loadFollowerIds(user.id)
      : [...graph.followedIds]
    const loaded = await getAwsPublicProfilesByIds(ids)
    const related = withRelationship(
      user.id,
      profilesInIdOrder(loaded, ids),
      graph.followedIds,
      graph.connections,
    )
    // Round H (H7): the Following list offers Message where the member's privacy choice allows it.
    const profiles = followView === 'following'
      ? withMessageAccess(related, await networkRepository.loadMessageAccess(user.id, related.map((profile) => profile.id)).catch(() => new Map<string, MessageAccess>()))
      : related

    return {
      tab,
      profiles: profiles.filter((profile) => matchesNetworkSearch(profile, normalizedSearch)),
      receivedRequests: [],
      sentRequests: [],
      incomingRequestCount,
      totalCount: profiles.length,
      followView,
    }
  }

  const receivedConnections = pending.filter((connection) => connection.requested_by !== user.id)
  const sentConnections = pending.filter((connection) => connection.requested_by === user.id)
  const receivedIds = receivedConnections.map((connection) => counterpartyId(user.id, connection))
  const sentIds = sentConnections.map((connection) => counterpartyId(user.id, connection))
  const [receivedProfiles, sentProfiles] = await Promise.all([
    getAwsPublicProfilesByIds(receivedIds),
    getAwsPublicProfilesByIds(sentIds),
  ])

  const orderedReceived = withRelationship(
    user.id,
    profilesInIdOrder(receivedProfiles, receivedIds),
    graph.followedIds,
    graph.connections,
  )
  const orderedSent = withRelationship(
    user.id,
    profilesInIdOrder(sentProfiles, sentIds),
    graph.followedIds,
    graph.connections,
  )

  return {
    tab,
    profiles: [],
    receivedRequests: orderedReceived,
    sentRequests: orderedSent,
    incomingRequestCount,
    totalCount: orderedReceived.length + orderedSent.length,
  }
}

const NO_RELATIONSHIP: RelationshipState = { following: false, connection: { kind: 'none', connectionId: null } }

/**
 * People you may know (round G hotfix): the SQL leaves out the viewer, connections, pending requests
 * either way, follows, recently declined requests, blocks, organisations and synthetic profiles
 * before the limit, so every returned member has no relationship with the viewer yet.
 */
export async function getPeopleSuggestions(limit: number = PEOPLE_SUGGESTION_LIMITS.rail, section: PeopleSection | null = null): Promise<NetworkProfile[]> {
  const user = await requireAwsUser()
  if (await isRankingEnabled('people', user.id)) {
    // Round G (G2): precomputed suggestions with reasons, exclusions re-checked live.
    const picked = await peopleSuggestionService.list(user.id, { limit, section })
    const cards = await getAwsProfileCards(picked.map((item) => item.candidateId))
    const byId = new Map(cards.map((profile) => [profile.id, profile]))
    const profiles = picked.flatMap((item) => {
      const profile = byId.get(item.candidateId)
      return profile ? [{ ...profile, relationship: NO_RELATIONSHIP, suggestionReason: item.reason }] : []
    })
    void incrementRankingMetric('pymk.lists_shown')
    void incrementRankingMetric('pymk.cards_listed', profiles.length)
    return profiles
  }
  const profiles = await getAwsPeopleSuggestions(limit)
  return profiles.map((profile) => ({ ...profile, relationship: NO_RELATIONSHIP }))
}

/** Round G (G2): "People similar to <name>" on a member's profile (people ranking on). */
export async function getPeopleSimilarTo(profileId: string, limit = 5): Promise<NetworkProfile[]> {
  const user = await requireAwsUser()
  if (!await isRankingEnabled('people', user.id)) return []
  const ids = await peopleCandidateRepository.listSimilarTo(user.id, profileId, limit)
  const cards = await getAwsProfileCards(ids)
  return cards.map((profile) => ({ ...profile, relationship: NO_RELATIONSHIP }))
}

/** Round G (G4): people search results as cards with the viewer's real relationship (Connect, Pending, Message). */
export async function getNetworkProfilesByIds(ids: readonly string[]): Promise<NetworkProfile[]> {
  if (!ids.length) return []
  const user = await requireAwsUser()
  const [cards, graph] = await Promise.all([getAwsProfileCards([...ids]), loadViewerGraph(user.id)])
  return withRelationship(user.id, profilesInIdOrder(cards, ids), graph.followedIds, graph.connections)
}

/** Round G: whether the precomputed People you may know (with sections and dismiss) is on for this member. */
export async function isPeopleRankingEnabled() {
  const user = await requireAwsUser()
  return isRankingEnabled('people', user.id)
}

/** The rail and feed-row suggestions: the cards shown plus spares that slide in after Connect. */
export async function getPeopleYouMayKnow(limit: number = PEOPLE_SUGGESTION_LIMITS.rail): Promise<NetworkProfile[]> {
  return getPeopleSuggestions(limit)
}

export async function getPreferredFeedAuthorIds(): Promise<Set<string>> {
  const user = await requireAwsUser()
  const graph = await loadViewerGraph(user.id)
  const preferred = new Set(graph.followedIds)

  for (const connection of graph.connections) {
    if (connection.status === 'accepted') preferred.add(counterpartyId(user.id, connection))
  }

  return preferred
}

import { requireAwsUser } from '@/features/auth/aws-queries'
import {
  getAwsNetworkProfiles,
  getAwsOwnProfile,
  getAwsPublicProfilesByIds,
} from '@/features/profiles/aws-queries'
import { networkRepository } from './repository'
import { scoreRecommendation } from './recommendations'
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
    profile.availability,
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

  if (tab === 'discover') {
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
    const profiles = withRelationship(
      user.id,
      profilesInIdOrder(loaded, ids),
      graph.followedIds,
      graph.connections,
    )

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

export async function getPeopleYouMayKnow(limit = 4): Promise<NetworkProfile[]> {
  const hub = await getNetworkHub('discover')
  return hub.profiles.slice(0, Math.min(Math.max(limit, 1), 5))
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

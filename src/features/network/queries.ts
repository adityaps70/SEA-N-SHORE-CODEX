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

export async function getNetworkHub(tab: NetworkTab): Promise<NetworkHubData> {
  const user = await requireAwsUser()
  const graph = await loadViewerGraph(user.id)
  const pending = graph.connections.filter((connection) => connection.status === 'pending')
  const incomingRequestCount = pending.filter((connection) => connection.requested_by !== user.id).length

  if (tab === 'discover') {
    const [viewer, candidates] = await Promise.all([getAwsOwnProfile(), getAwsNetworkProfiles(60)])
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
      .filter(({ profile }) => profile.relationship.connection.kind !== 'connected')
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .slice(0, 30)
      .map(({ profile }) => profile)

    return {
      tab,
      profiles: ranked,
      receivedRequests: [],
      sentRequests: [],
      incomingRequestCount,
    }
  }

  if (tab === 'connections') {
    const accepted = graph.connections.filter((connection) => connection.status === 'accepted')
    const ids = accepted.map((connection) => counterpartyId(user.id, connection))
    const profiles = await getAwsPublicProfilesByIds(ids)
    return {
      tab,
      profiles: withRelationship(user.id, profiles, graph.followedIds, graph.connections),
      receivedRequests: [],
      sentRequests: [],
      incomingRequestCount,
    }
  }

  if (tab === 'following') {
    const ids = [...graph.followedIds]
    const profiles = await getAwsPublicProfilesByIds(ids)
    return {
      tab,
      profiles: withRelationship(user.id, profiles, graph.followedIds, graph.connections),
      receivedRequests: [],
      sentRequests: [],
      incomingRequestCount,
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

  return {
    tab,
    profiles: [],
    receivedRequests: withRelationship(user.id, receivedProfiles, graph.followedIds, graph.connections),
    sentRequests: withRelationship(user.id, sentProfiles, graph.followedIds, graph.connections),
    incomingRequestCount,
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

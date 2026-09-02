import { requireUser } from '@/features/auth/queries'
import { getNetworkProfiles, getOwnProfile, getPublicProfilesByIds } from '@/features/profiles/queries'
import { createServerSupabaseClient } from '@/lib/supabase/server'
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
  const supabase = await createServerSupabaseClient()
  const [follows, connections] = await Promise.all([
    supabase
      .from('follows')
      .select('following_id')
      .eq('follower_id', viewerId),
    supabase
      .from('connections')
      .select('id,user_low_id,user_high_id,requested_by,status,created_at,updated_at')
      .or(`user_low_id.eq.${viewerId},user_high_id.eq.${viewerId}`)
      .order('updated_at', { ascending: false }),
  ])

  if (follows.error || connections.error) {
    throw new Error('Unable to load your professional relationships.')
  }

  return {
    followedIds: new Set((follows.data ?? []).map((row) => row.following_id)),
    connections: (connections.data ?? []) as NetworkConnectionRow[],
  }
}

function withRelationship(
  viewerId: string,
  profiles: Awaited<ReturnType<typeof getPublicProfilesByIds>>,
  followedIds: ReadonlySet<string>,
  connections: readonly NetworkConnectionRow[],
): NetworkProfile[] {
  return profiles.map((profile) => ({
    ...profile,
    relationship: relationshipFromRows(viewerId, profile.id, followedIds, connections),
  }))
}

export async function getRelationshipState(targetId: string): Promise<RelationshipState> {
  const user = await requireUser()
  const graph = await loadViewerGraph(user.id)
  return relationshipFromRows(user.id, targetId, graph.followedIds, graph.connections)
}

export async function getNetworkHub(tab: NetworkTab): Promise<NetworkHubData> {
  const user = await requireUser()
  const graph = await loadViewerGraph(user.id)
  const pending = graph.connections.filter((connection) => connection.status === 'pending')
  const incomingRequestCount = pending.filter((connection) => connection.requested_by !== user.id).length

  if (tab === 'discover') {
    const [viewer, candidates] = await Promise.all([getOwnProfile(), getNetworkProfiles(60)])
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
    const profiles = await getPublicProfilesByIds(ids)
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
    const profiles = await getPublicProfilesByIds(ids)
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
    getPublicProfilesByIds(receivedIds),
    getPublicProfilesByIds(sentIds),
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
  const user = await requireUser()
  const graph = await loadViewerGraph(user.id)
  const preferred = new Set(graph.followedIds)

  for (const connection of graph.connections) {
    if (connection.status === 'accepted') preferred.add(counterpartyId(user.id, connection))
  }

  return preferred
}

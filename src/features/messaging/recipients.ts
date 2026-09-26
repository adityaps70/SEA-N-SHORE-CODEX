import type { NetworkConnectionRow } from '@/features/network/types'
import type { PublicProfile } from '@/features/profiles/types'

export const MESSAGE_RECIPIENT_QUERY_MAX_LENGTH = 80
export const MESSAGE_RECIPIENT_RESULT_LIMIT = 20
const PENDING_RESULT_LIMIT = 5

export type MessageRecipientStatus = 'available' | 'request_sent' | 'request_received'

export type MessageRecipient = {
  profileId: string
  name: string
  subtitle: string | null
  slug: string
  avatarUrl: string | null
  /** Existing direct conversation with this person, reused instead of creating a duplicate. */
  conversationId: string | null
  status: MessageRecipientStatus
  /** Plain explanation shown when this person cannot be messaged yet. */
  unavailableReason: string | null
}

export type MessageRecipientSearchResult = {
  query: string
  recipients: MessageRecipient[]
  connectionCount: number
}

export type MessageRecipientSearchDependencies = {
  requireUser: () => Promise<{ id: string }>
  loadViewerGraph: (viewerId: string) => Promise<{ connections: readonly NetworkConnectionRow[] }>
  /** Profiles without signed media, used for matching before signing anything. */
  loadProfiles: (input: { ids: string[]; viewerProfileId: string }) => Promise<PublicProfile[]>
  /** Same profiles with signed avatar URLs; only called for the few results returned. */
  loadHydratedProfiles: (ids: string[]) => Promise<PublicProfile[]>
  listDirectConversationsWithPeers: (
    viewerId: string,
    peerIds: readonly string[],
  ) => Promise<Map<string, { conversationId: string; lastMessageAt: string | null }>>
}

export function normalizeMessageRecipientQuery(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_RECIPIENT_QUERY_MAX_LENGTH)
}

function counterpartyId(viewerId: string, row: NetworkConnectionRow) {
  return row.user_low_id === viewerId ? row.user_high_id : row.user_low_id
}

function searchableText(profile: PublicProfile) {
  return [
    profile.fullName,
    profile.slug,
    profile.headline,
    profile.rank,
    profile.currentCompany,
    profile.currentVessel,
    profile.location,
    profile.primaryIdentity,
    profile.institutionName,
  ]
    .filter((value): value is string => Boolean(value))
    .join(' ')
    .toLocaleLowerCase()
}

function matches(profile: PublicProfile, tokens: string[]) {
  if (!tokens.length) return true
  const haystack = searchableText(profile)
  return tokens.every((token) => haystack.includes(token))
}

function nameScore(profile: PublicProfile, query: string) {
  if (!query) return 0
  const name = profile.fullName.toLocaleLowerCase()
  if (name.startsWith(query)) return 2
  if (name.split(/\s+/).some((part) => part.startsWith(query))) return 1
  return 0
}

function subtitle(profile: PublicProfile) {
  return [profile.rank, profile.currentCompany].filter(Boolean).join(' · ')
    || profile.headline
    || null
}

const UNAVAILABLE_REASON: Record<Exclude<MessageRecipientStatus, 'available'>, string> = {
  request_sent: 'Your connection request is pending. You can message once they accept it.',
  request_received: 'They sent you a connection request. Accept it in My Network to start messaging.',
}

/**
 * Finds people the viewer may start a conversation with. Only accepted
 * connections are messageable (the same rule the server enforces when a
 * conversation is created or a message is sent). Pending connections are
 * returned only for a typed search, marked unavailable with the reason, so the
 * member understands why someone they are looking for cannot be selected.
 * The viewer and blocked or inactive members are never returned.
 */
export function createMessageRecipientSearch(deps: MessageRecipientSearchDependencies) {
  return async function searchMessageRecipients(rawQuery: unknown): Promise<MessageRecipientSearchResult> {
    const query = normalizeMessageRecipientQuery(rawQuery)
    const user = await deps.requireUser()
    const graph = await deps.loadViewerGraph(user.id)

    const acceptedIds: string[] = []
    const pendingStatus = new Map<string, MessageRecipientStatus>()
    for (const connection of graph.connections) {
      const peerId = counterpartyId(user.id, connection)
      if (!peerId || peerId === user.id) continue
      if (connection.status === 'accepted') {
        acceptedIds.push(peerId)
      } else if (query) {
        pendingStatus.set(peerId, connection.requested_by === user.id ? 'request_sent' : 'request_received')
      }
    }
    const uniqueAccepted = [...new Set(acceptedIds)]
    const candidateIds = [...new Set([...uniqueAccepted, ...pendingStatus.keys()])]
    if (!candidateIds.length) {
      return { query, recipients: [], connectionCount: 0 }
    }

    const [profiles, conversations] = await Promise.all([
      deps.loadProfiles({ ids: candidateIds, viewerProfileId: user.id }),
      deps.listDirectConversationsWithPeers(user.id, uniqueAccepted),
    ])

    const acceptedSet = new Set(uniqueAccepted)
    const visibleProfiles = profiles.filter((profile) => profile.id !== user.id)
    const connectionCount = visibleProfiles.filter((profile) => acceptedSet.has(profile.id)).length
    const loweredQuery = query.toLocaleLowerCase()
    const tokens = loweredQuery.split(' ').filter(Boolean)
    const order = new Map(candidateIds.map((id, index) => [id, index]))

    const matched = visibleProfiles.filter((profile) => matches(profile, tokens))
    const available = matched
      .filter((profile) => acceptedSet.has(profile.id))
      .sort((left, right) => {
        const byName = nameScore(right, loweredQuery) - nameScore(left, loweredQuery)
        if (byName) return byName
        const leftAt = conversations.get(left.id)?.lastMessageAt ?? ''
        const rightAt = conversations.get(right.id)?.lastMessageAt ?? ''
        if (leftAt !== rightAt) return rightAt.localeCompare(leftAt)
        return (order.get(left.id) ?? 0) - (order.get(right.id) ?? 0)
      })
      .slice(0, MESSAGE_RECIPIENT_RESULT_LIMIT)
    const pending = matched
      .filter((profile) => !acceptedSet.has(profile.id) && pendingStatus.has(profile.id))
      .slice(0, PENDING_RESULT_LIMIT)

    const selected = [...available, ...pending]
    const hydrated = selected.length ? await deps.loadHydratedProfiles(selected.map((profile) => profile.id)) : []
    const avatarById = new Map(hydrated.map((profile) => [profile.id, profile.avatarUrl ?? null]))

    return {
      query,
      connectionCount,
      recipients: selected.map((profile) => {
        const status = acceptedSet.has(profile.id)
          ? 'available' as const
          : pendingStatus.get(profile.id) ?? 'request_sent'
        return {
          profileId: profile.id,
          name: profile.fullName,
          subtitle: subtitle(profile),
          slug: profile.slug,
          avatarUrl: avatarById.get(profile.id) ?? null,
          conversationId: status === 'available' ? conversations.get(profile.id)?.conversationId ?? null : null,
          status,
          unavailableReason: status === 'available' ? null : UNAVAILABLE_REASON[status],
        }
      }),
    }
  }
}

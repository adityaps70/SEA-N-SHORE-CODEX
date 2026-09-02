import type { PublicProfile } from '@/features/profiles/types'

export const NETWORK_TABS = ['discover', 'connections', 'requests', 'following'] as const

export type NetworkTab = (typeof NETWORK_TABS)[number]

export type ConnectionRelationship =
  | { kind: 'none'; connectionId: null }
  | { kind: 'incoming_pending'; connectionId: string }
  | { kind: 'outgoing_pending'; connectionId: string }
  | { kind: 'connected'; connectionId: string }

export type RelationshipState = {
  following: boolean
  connection: ConnectionRelationship
}

export type NetworkProfile = PublicProfile & {
  relationship: RelationshipState
}

export type NetworkConnectionRow = {
  id: string
  user_low_id: string
  user_high_id: string
  requested_by: string
  status: 'pending' | 'accepted'
  created_at: string
  updated_at: string
}

export type NetworkHubData = {
  tab: NetworkTab
  profiles: NetworkProfile[]
  receivedRequests: NetworkProfile[]
  sentRequests: NetworkProfile[]
  incomingRequestCount: number
}

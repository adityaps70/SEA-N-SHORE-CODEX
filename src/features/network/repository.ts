import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import type { NetworkConnectionRow } from './types'

export type NetworkNotificationType = 'connection_request' | 'connection_accepted' | 'new_follower'

type NetworkQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<QueryResultRow[]>

type FollowRow = QueryResultRow & { following_id: string }
type BooleanRow = QueryResultRow & { ready?: boolean; blocked?: boolean; created?: boolean; deleted?: boolean; updated?: boolean }
type IdRow = QueryResultRow & { id: string }
type ConnectionRow = QueryResultRow & NetworkConnectionRow

function canonicalPair(userA: string, userB: string) {
  return userA < userB ? [userA, userB] as const : [userB, userA] as const
}

export function createNetworkRepository(input: { query?: NetworkQuery } = {}) {
  const queryRows: NetworkQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  async function loadViewerGraph(viewerId: string) {
    const follows = await queryRows(
      `select following_id
       from public.follows
       where follower_id = $1
       order by created_at desc, following_id asc`,
      [viewerId],
    ) as FollowRow[]

    const connections = await queryRows(
      `select id, user_low_id, user_high_id, requested_by, status::text as status, created_at, updated_at
       from public.connections
       where user_low_id = $1 or user_high_id = $1
       order by updated_at desc, id asc`,
      [viewerId],
    ) as ConnectionRow[]

    return {
      followedIds: new Set(follows.map((row) => row.following_id)),
      connections: connections as NetworkConnectionRow[],
    }
  }

  async function isMemberReady(profileId: string) {
    const rows = await queryRows(
      `select exists (
         select 1
         from public.profiles p
         where p.id = $1
           and p.account_status = 'active'
           and p.onboarding_completed_at is not null
       ) as ready`,
      [profileId],
    ) as BooleanRow[]
    return Boolean(rows[0]?.ready)
  }

  async function isPairBlocked(userA: string, userB: string) {
    const rows = await queryRows(
      `select exists (
         select 1
         from public.user_blocks
         where (blocker_id = $1 and blocked_id = $2)
            or (blocker_id = $2 and blocked_id = $1)
       ) as blocked`,
      [userA, userB],
    ) as BooleanRow[]
    return Boolean(rows[0]?.blocked)
  }

  async function findConnectionByPair(userA: string, userB: string) {
    const [low, high] = canonicalPair(userA, userB)
    const rows = await queryRows(
      `select id, user_low_id, user_high_id, requested_by, status::text as status, created_at, updated_at
       from public.connections
       where user_low_id = $1 and user_high_id = $2
       limit 1`,
      [low, high],
    ) as ConnectionRow[]
    return rows[0] ?? null
  }

  async function findConnectionByIdForUpdate(connectionId: string) {
    const rows = await queryRows(
      `select id, user_low_id, user_high_id, requested_by, status::text as status, created_at, updated_at
       from public.connections
       where id = $1
       for update`,
      [connectionId],
    ) as ConnectionRow[]
    return rows[0] ?? null
  }

  async function insertFollow(followerId: string, followingId: string) {
    const rows = await queryRows(
      `insert into public.follows (follower_id, following_id)
       values ($1, $2)
       on conflict do nothing
       returning true as created`,
      [followerId, followingId],
    ) as BooleanRow[]
    return Boolean(rows[0]?.created)
  }

  async function deleteFollow(followerId: string, followingId: string) {
    const rows = await queryRows(
      `delete from public.follows
       where follower_id = $1 and following_id = $2
       returning true as deleted`,
      [followerId, followingId],
    ) as BooleanRow[]
    return Boolean(rows[0]?.deleted)
  }

  async function createNotification(input: {
    recipientId: string
    actorId: string
    type: NetworkNotificationType
    connectionId?: string
  }) {
    await queryRows(
      `insert into public.notifications (
         recipient_id, actor_id, notification_type, connection_id
       ) values ($1, $2, $3, $4)`,
      [input.recipientId, input.actorId, input.type, input.connectionId ?? null],
    )
  }

  async function insertConnection(userA: string, userB: string, requestedBy: string) {
    const [low, high] = canonicalPair(userA, userB)
    const rows = await queryRows(
      `insert into public.connections (
         user_low_id, user_high_id, requested_by, status
       ) values ($1, $2, $3, 'pending')
       returning id`,
      [low, high, requestedBy],
    ) as IdRow[]
    const id = rows[0]?.id
    if (!id) throw new Error('network_action_not_allowed')
    return id
  }

  async function deleteConnectionRequestNotification(connectionId: string) {
    await queryRows(
      `delete from public.notifications
       where connection_id = $1
         and notification_type = 'connection_request'`,
      [connectionId],
    )
  }

  async function deleteConnection(connectionId: string) {
    const rows = await queryRows(
      `delete from public.connections
       where id = $1
       returning true as deleted`,
      [connectionId],
    ) as BooleanRow[]
    return Boolean(rows[0]?.deleted)
  }

  async function acceptConnection(connectionId: string) {
    const rows = await queryRows(
      `update public.connections
       set status = 'accepted', responded_at = now()
       where id = $1
       returning true as updated`,
      [connectionId],
    ) as BooleanRow[]
    return Boolean(rows[0]?.updated)
  }

  async function insertMutualFollows(userA: string, userB: string) {
    await queryRows(
      `insert into public.follows (follower_id, following_id)
       values ($1, $2), ($2, $1)
       on conflict do nothing`,
      [userA, userB],
    )
  }

  async function insertBlock(blockerId: string, blockedId: string) {
    const rows = await queryRows(
      `insert into public.user_blocks (blocker_id, blocked_id)
       values ($1, $2)
       on conflict do nothing
       returning true as created`,
      [blockerId, blockedId],
    ) as BooleanRow[]
    return Boolean(rows[0]?.created)
  }

  async function deleteBlock(blockerId: string, blockedId: string) {
    const rows = await queryRows(
      `delete from public.user_blocks
       where blocker_id = $1 and blocked_id = $2
       returning true as deleted`,
      [blockerId, blockedId],
    ) as BooleanRow[]
    return Boolean(rows[0]?.deleted)
  }

  async function deletePairRelationships(userA: string, userB: string) {
    const [low, high] = canonicalPair(userA, userB)
    await queryRows(
      `delete from public.follows
       where (follower_id = $1 and following_id = $2)
          or (follower_id = $2 and following_id = $1)`,
      [userA, userB],
    )
    await queryRows(
      `delete from public.notifications n
       using public.connections c
       where n.connection_id = c.id
         and n.notification_type = 'connection_request'
         and c.user_low_id = $1
         and c.user_high_id = $2`,
      [low, high],
    )
    await queryRows(
      `delete from public.connections
       where user_low_id = $1 and user_high_id = $2`,
      [low, high],
    )
  }

  return {
    loadViewerGraph,
    isMemberReady,
    isPairBlocked,
    findConnectionByPair,
    findConnectionByIdForUpdate,
    insertFollow,
    deleteFollow,
    createNotification,
    insertConnection,
    deleteConnectionRequestNotification,
    deleteConnection,
    acceptConnection,
    insertMutualFollows,
    insertBlock,
    deleteBlock,
    deletePairRelationships,
  }
}

export type NetworkRepository = ReturnType<typeof createNetworkRepository>

export function createNetworkRepositoryForClient(client: DatabaseQueryClient) {
  return createNetworkRepository({
    query: async (text, values) => (await client.query(text, values)).rows,
  })
}

export const networkRepository = createNetworkRepository()

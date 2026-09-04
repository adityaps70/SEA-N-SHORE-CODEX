import { withTransaction as databaseTransaction } from '@/lib/db/client'
import {
  createNetworkRepositoryForClient,
  type NetworkRepository,
} from './repository'
import type { NetworkConnectionRow } from './types'

type NetworkTransaction = <T>(fn: (repository: NetworkRepository) => Promise<T>) => Promise<T>

function serviceError(code: string): never {
  throw new Error(code)
}

function assertNotSelf(actorId: string, targetId: string) {
  if (actorId === targetId) serviceError('network_self_interaction')
}

async function assertInteractable(
  repository: NetworkRepository,
  actorId: string,
  targetId: string,
) {
  const actorReady = await repository.isMemberReady(actorId)
  if (!actorReady) serviceError('network_interaction_unavailable')

  const targetReady = await repository.isMemberReady(targetId)
  if (!targetReady) serviceError('network_interaction_unavailable')

  if (await repository.isPairBlocked(actorId, targetId)) {
    serviceError('network_interaction_unavailable')
  }
}

function connectionOtherMember(connection: NetworkConnectionRow, actorId: string) {
  if (connection.user_low_id === actorId) return connection.user_high_id
  if (connection.user_high_id === actorId) return connection.user_low_id
  return null
}

function isUniqueViolation(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
}

function duplicateConnectionError(connection: NetworkConnectionRow | null): never {
  if (connection?.status === 'accepted') serviceError('network_already_connected')
  serviceError('network_request_exists')
}

export function createNetworkService(input: { withTransaction: NetworkTransaction }) {
  async function follow(actorId: string, targetId: string) {
    assertNotSelf(actorId, targetId)
    return input.withTransaction(async (repository) => {
      await assertInteractable(repository, actorId, targetId)
      const created = await repository.insertFollow(actorId, targetId)
      if (created) {
        await repository.createNotification({
          recipientId: targetId,
          actorId,
          type: 'new_follower',
        })
      }
      return created
    })
  }

  async function unfollow(actorId: string, targetId: string) {
    assertNotSelf(actorId, targetId)
    return input.withTransaction((repository) => repository.deleteFollow(actorId, targetId))
  }

  async function sendConnectionRequest(actorId: string, targetId: string) {
    assertNotSelf(actorId, targetId)
    return input.withTransaction(async (repository) => {
      await assertInteractable(repository, actorId, targetId)
      const existing = await repository.findConnectionByPair(actorId, targetId)
      if (existing) duplicateConnectionError(existing)

      let connectionId: string
      try {
        connectionId = await repository.insertConnection(actorId, targetId, actorId)
      } catch (error) {
        if (!isUniqueViolation(error)) throw error
        duplicateConnectionError(await repository.findConnectionByPair(actorId, targetId))
      }

      await repository.createNotification({
        recipientId: targetId,
        actorId,
        type: 'connection_request',
        connectionId,
      })
      return connectionId
    })
  }

  async function cancelConnectionRequest(actorId: string, connectionId: string) {
    return input.withTransaction(async (repository) => {
      const connection = await repository.findConnectionByIdForUpdate(connectionId)
      if (!connection || connection.status !== 'pending' || connection.requested_by !== actorId) {
        serviceError('network_action_not_allowed')
      }

      await repository.deleteConnectionRequestNotification(connectionId)
      return repository.deleteConnection(connectionId)
    })
  }

  async function acceptConnectionRequest(actorId: string, connectionId: string) {
    return input.withTransaction(async (repository) => {
      const connection = await repository.findConnectionByIdForUpdate(connectionId)
      if (!connection || connection.status !== 'pending' || connection.requested_by === actorId) {
        serviceError('network_action_not_allowed')
      }

      const otherId = connectionOtherMember(connection, actorId)
      if (!otherId) serviceError('network_action_not_allowed')

      await assertInteractable(repository, actorId, otherId)
      await repository.acceptConnection(connectionId)
      await repository.insertMutualFollows(actorId, otherId)
      await repository.deleteConnectionRequestNotification(connectionId)
      await repository.createNotification({
        recipientId: connection.requested_by,
        actorId,
        type: 'connection_accepted',
        connectionId,
      })
      return true
    })
  }

  async function declineConnectionRequest(actorId: string, connectionId: string) {
    return input.withTransaction(async (repository) => {
      const connection = await repository.findConnectionByIdForUpdate(connectionId)
      if (!connection || connection.status !== 'pending' || connection.requested_by === actorId) {
        serviceError('network_action_not_allowed')
      }

      if (!connectionOtherMember(connection, actorId)) serviceError('network_action_not_allowed')
      await repository.deleteConnectionRequestNotification(connectionId)
      return repository.deleteConnection(connectionId)
    })
  }

  async function removeConnection(actorId: string, connectionId: string) {
    return input.withTransaction(async (repository) => {
      const connection = await repository.findConnectionByIdForUpdate(connectionId)
      if (!connection || connection.status !== 'accepted' || !connectionOtherMember(connection, actorId)) {
        serviceError('network_action_not_allowed')
      }
      return repository.deleteConnection(connectionId)
    })
  }

  async function block(actorId: string, targetId: string) {
    assertNotSelf(actorId, targetId)
    return input.withTransaction(async (repository) => {
      const actorReady = await repository.isMemberReady(actorId)
      const targetReady = await repository.isMemberReady(targetId)
      if (!actorReady || !targetReady) serviceError('network_interaction_unavailable')

      const created = await repository.insertBlock(actorId, targetId)
      await repository.deletePairRelationships(actorId, targetId)
      return created
    })
  }

  async function unblock(actorId: string, targetId: string) {
    assertNotSelf(actorId, targetId)
    return input.withTransaction((repository) => repository.deleteBlock(actorId, targetId))
  }

  return {
    follow,
    unfollow,
    sendConnectionRequest,
    cancelConnectionRequest,
    acceptConnectionRequest,
    declineConnectionRequest,
    removeConnection,
    block,
    unblock,
  }
}

const productionService = createNetworkService({
  withTransaction: (fn) => databaseTransaction((client) => fn(createNetworkRepositoryForClient(client))),
})

export const followProfileWithAurora = productionService.follow
export const unfollowProfileWithAurora = productionService.unfollow
export const sendConnectionRequestWithAurora = productionService.sendConnectionRequest
export const cancelConnectionRequestWithAurora = productionService.cancelConnectionRequest
export const acceptConnectionRequestWithAurora = productionService.acceptConnectionRequest
export const declineConnectionRequestWithAurora = productionService.declineConnectionRequest
export const removeConnectionWithAurora = productionService.removeConnection
export const blockProfileWithAurora = productionService.block
export const unblockProfileWithAurora = productionService.unblock

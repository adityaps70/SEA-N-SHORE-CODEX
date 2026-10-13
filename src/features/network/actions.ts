'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { messageForErrorCode } from '@/lib/errors/user-messages'
import {
  acceptConnectionRequestWithAurora,
  blockProfileWithAurora,
  cancelConnectionRequestWithAurora,
  declineConnectionRequestWithAurora,
  followProfileWithAurora,
  removeConnectionWithAurora,
  sendConnectionRequestWithAurora,
  unblockProfileWithAurora,
  unfollowProfileWithAurora,
} from './service'
import { connectionActionSchema, targetProfileSchema } from './schemas'
import { refreshPeopleSuggestionsQuietly, removePeopleSuggestionPair } from '@/features/ranking/people-refresh'
import { incrementRankingMetric } from '@/features/signals/repository'

export type NetworkActionResult = { ok: true } | { ok: false; error: string }

function networkError(message?: string) {
  switch (message) {
    case 'network_request_exists': return 'Request already sent.'
    case 'network_already_connected': return 'You’re already connected.'
    case 'network_interaction_unavailable':
    case 'network_action_not_allowed': return 'This interaction is not available.'
    case 'network_self_interaction': return 'You cannot perform this action on your own profile.'
    case 'network_connection_request_limit':
    case 'network_connection_request_cooldown': return messageForErrorCode(message)
    default: return 'We could not update this relationship. Please try again.'
  }
}

function revalidateNetworkSurfaces() {
  revalidatePath('/network')
  revalidatePath('/home')
  revalidatePath('/notifications')
}

/**
 * Round G (G2): a person the member just asked to connect, followed or blocked leaves their People
 * you may know at once (both ways for a block), not at the next nightly run.
 */
async function dropSuggestion(actorId: string, targetId: string, bothWays = false) {
  try {
    await removePeopleSuggestionPair(actorId, targetId, bothWays)
  } catch {
    // Before migration 0083 there is no table; the live exclusions still hide the person.
  }
}

async function targetAction(
  action: (actorId: string, targetId: string) => Promise<unknown>,
  targetId: string,
  after?: (actorId: string, targetId: string) => Promise<void>,
): Promise<NetworkActionResult> {
  const parsed = targetProfileSchema.safeParse({ targetId })
  if (!parsed.success) return { ok: false, error: 'Invalid member.' }

  try {
    const user = await requireAwsUser()
    await action(user.id, parsed.data.targetId)
    if (after) await after(user.id, parsed.data.targetId)
  } catch (error) {
    return {
      ok: false,
      error: networkError(error instanceof Error ? error.message : undefined),
    }
  }

  revalidateNetworkSurfaces()
  return { ok: true }
}

async function connectionAction(
  action: (actorId: string, connectionId: string) => Promise<unknown>,
  connectionId: string,
  after?: (actorId: string) => Promise<void>,
): Promise<NetworkActionResult> {
  const parsed = connectionActionSchema.safeParse({ connectionId })
  if (!parsed.success) return { ok: false, error: 'Invalid connection request.' }

  try {
    const user = await requireAwsUser()
    await action(user.id, parsed.data.connectionId)
    if (after) await after(user.id)
  } catch (error) {
    return {
      ok: false,
      error: networkError(error instanceof Error ? error.message : undefined),
    }
  }

  revalidateNetworkSurfaces()
  return { ok: true }
}

export async function followProfile(targetId: string) {
  return targetAction(followProfileWithAurora, targetId, (actorId, id) => dropSuggestion(actorId, id))
}

export async function unfollowProfile(targetId: string) {
  return targetAction(unfollowProfileWithAurora, targetId)
}

export async function sendConnectionRequest(targetId: string) {
  return targetAction(sendConnectionRequestWithAurora, targetId, async (actorId, id) => {
    await dropSuggestion(actorId, id)
    void incrementRankingMetric('pymk.requests_sent')
  })
}

export async function cancelConnectionRequest(connectionId: string) {
  return connectionAction(cancelConnectionRequestWithAurora, connectionId)
}

export async function acceptConnectionRequest(connectionId: string) {
  // Round G (G2): a new connection changes mutual counts, so the member's suggestions are recomputed.
  return connectionAction(acceptConnectionRequestWithAurora, connectionId, (actorId) => refreshPeopleSuggestionsQuietly(actorId))
}

export async function declineConnectionRequest(connectionId: string) {
  return connectionAction(declineConnectionRequestWithAurora, connectionId)
}

export async function removeConnection(connectionId: string) {
  return connectionAction(removeConnectionWithAurora, connectionId)
}

export async function blockProfile(targetId: string) {
  return targetAction(blockProfileWithAurora, targetId, (actorId, id) => dropSuggestion(actorId, id, true))
}

export async function unblockProfile(targetId: string) {
  return targetAction(unblockProfileWithAurora, targetId)
}

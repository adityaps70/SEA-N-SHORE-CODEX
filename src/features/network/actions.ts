'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
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

export type NetworkActionResult = { ok: true } | { ok: false; error: string }

function networkError(message?: string) {
  switch (message) {
    case 'network_request_exists': return 'Request already sent.'
    case 'network_already_connected': return 'You’re already connected.'
    case 'network_interaction_unavailable':
    case 'network_action_not_allowed': return 'This interaction is not available.'
    case 'network_self_interaction': return 'You cannot perform this action on your own profile.'
    default: return 'We could not update this relationship. Please try again.'
  }
}

function revalidateNetworkSurfaces() {
  revalidatePath('/network')
  revalidatePath('/home')
  revalidatePath('/notifications')
}

async function targetAction(
  action: (actorId: string, targetId: string) => Promise<unknown>,
  targetId: string,
): Promise<NetworkActionResult> {
  const parsed = targetProfileSchema.safeParse({ targetId })
  if (!parsed.success) return { ok: false, error: 'Invalid member.' }

  try {
    const user = await requireAwsUser()
    await action(user.id, parsed.data.targetId)
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
): Promise<NetworkActionResult> {
  const parsed = connectionActionSchema.safeParse({ connectionId })
  if (!parsed.success) return { ok: false, error: 'Invalid connection request.' }

  try {
    const user = await requireAwsUser()
    await action(user.id, parsed.data.connectionId)
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
  return targetAction(followProfileWithAurora, targetId)
}

export async function unfollowProfile(targetId: string) {
  return targetAction(unfollowProfileWithAurora, targetId)
}

export async function sendConnectionRequest(targetId: string) {
  return targetAction(sendConnectionRequestWithAurora, targetId)
}

export async function cancelConnectionRequest(connectionId: string) {
  return connectionAction(cancelConnectionRequestWithAurora, connectionId)
}

export async function acceptConnectionRequest(connectionId: string) {
  return connectionAction(acceptConnectionRequestWithAurora, connectionId)
}

export async function declineConnectionRequest(connectionId: string) {
  return connectionAction(declineConnectionRequestWithAurora, connectionId)
}

export async function removeConnection(connectionId: string) {
  return connectionAction(removeConnectionWithAurora, connectionId)
}

export async function blockProfile(targetId: string) {
  return targetAction(blockProfileWithAurora, targetId)
}

export async function unblockProfile(targetId: string) {
  return targetAction(unblockProfileWithAurora, targetId)
}

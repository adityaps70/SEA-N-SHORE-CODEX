'use server'

import { revalidatePath } from 'next/cache'
import { requireUser } from '@/features/auth/queries'
import { createServerSupabaseClient } from '@/lib/supabase/server'
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
  rpc: 'follow_profile' | 'unfollow_profile' | 'send_connection_request' | 'block_profile' | 'unblock_profile',
  targetId: string,
): Promise<NetworkActionResult> {
  const parsed = targetProfileSchema.safeParse({ targetId })
  if (!parsed.success) return { ok: false, error: 'Invalid member.' }

  await requireUser()
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc(rpc, { p_target_id: parsed.data.targetId })
  if (error) return { ok: false, error: networkError(error.message) }

  revalidateNetworkSurfaces()
  return { ok: true }
}

async function connectionAction(
  rpc: 'cancel_connection_request' | 'accept_connection_request' | 'decline_connection_request' | 'remove_connection',
  connectionId: string,
): Promise<NetworkActionResult> {
  const parsed = connectionActionSchema.safeParse({ connectionId })
  if (!parsed.success) return { ok: false, error: 'Invalid connection request.' }

  await requireUser()
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc(rpc, { p_connection_id: parsed.data.connectionId })
  if (error) return { ok: false, error: networkError(error.message) }

  revalidateNetworkSurfaces()
  return { ok: true }
}

export async function followProfile(targetId: string) {
  return targetAction('follow_profile', targetId)
}

export async function unfollowProfile(targetId: string) {
  return targetAction('unfollow_profile', targetId)
}

export async function sendConnectionRequest(targetId: string) {
  return targetAction('send_connection_request', targetId)
}

export async function cancelConnectionRequest(connectionId: string) {
  return connectionAction('cancel_connection_request', connectionId)
}

export async function acceptConnectionRequest(connectionId: string) {
  return connectionAction('accept_connection_request', connectionId)
}

export async function declineConnectionRequest(connectionId: string) {
  return connectionAction('decline_connection_request', connectionId)
}

export async function removeConnection(connectionId: string) {
  return connectionAction('remove_connection', connectionId)
}

export async function blockProfile(targetId: string) {
  return targetAction('block_profile', targetId)
}

export async function unblockProfile(targetId: string) {
  return targetAction('unblock_profile', targetId)
}

'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { CommunityServiceError, communityService, type CommunityServiceErrorCode } from './service'
import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_ICON_NAMES,
  GROUP_RULES_MAX_LENGTH,
  GROUP_VISIBILITIES,
  type MembershipStatus,
} from './types'

export type CommunityActionResult = { ok: true } | { ok: false; error: string }
export type JoinGroupResult = { ok: true; status: MembershipStatus } | { ok: false; error: string }

const uuid = z.string().uuid()
const memberSchema = z.object({ groupId: uuid, profileId: uuid })
const roleSchema = memberSchema.extend({ role: z.enum(['member', 'admin']) })

const groupEditSchema = z.object({
  groupId: uuid,
  description: z.string().trim().max(GROUP_DESCRIPTION_MAX_LENGTH, 'The description is too long (2,000 characters at most).'),
  rules: z.string().trim().max(GROUP_RULES_MAX_LENGTH, 'The rules are too long (4,000 characters at most).'),
  visibility: z.enum(GROUP_VISIBILITIES),
  icon: z.preprocess((value) => (typeof value === 'string' && value ? value : null), z.enum(GROUP_ICON_NAMES).nullable()),
})

const ERROR_MESSAGES: Record<CommunityServiceErrorCode, string> = {
  group_not_found: 'This group could not be found.',
  group_archived: 'This group has been archived.',
  group_join_blocked: 'You were removed from this group. Ask a group admin if you would like to rejoin.',
  group_forbidden: 'Only the admins of this group can do that.',
  group_owner_protected: 'The group owner cannot be removed or changed here.',
  group_self_action: 'You cannot do that to your own membership. Use Leave group instead.',
  group_member_not_found: 'That member or request is no longer in the group.',
  group_post_not_found: 'This post is not in a group you manage.',
  group_owner_not_found: 'No active member matches that email or handle.',
}

export async function communityErrorMessage(error: unknown, fallback: string) {
  return error instanceof CommunityServiceError ? ERROR_MESSAGES[error.code] : fallback
}

function revalidateCommunity() {
  revalidatePath('/community')
  revalidatePath('/community/[slug]', 'page')
  revalidatePath('/notifications')
}

async function run(work: () => Promise<void>, fallback: string): Promise<CommunityActionResult> {
  try {
    await work()
  } catch (error) {
    return { ok: false, error: await communityErrorMessage(error, fallback) }
  }
  revalidateCommunity()
  return { ok: true }
}

/** Joins a public group at once, or asks to join a private one. */
export async function joinGroup(groupId: string): Promise<JoinGroupResult> {
  const parsed = uuid.safeParse(groupId)
  if (!parsed.success) return { ok: false, error: ERROR_MESSAGES.group_not_found }
  const user = await requireAwsUser()
  try {
    const result = await communityService.joinGroup(user.id, parsed.data)
    revalidateCommunity()
    return { ok: true, status: result.status }
  } catch (error) {
    return { ok: false, error: await communityErrorMessage(error, 'We could not join this group. Please try again.') }
  }
}

/** Private groups: the same as joinGroup, kept as its own action for clearer call sites. */
export async function requestToJoin(groupId: string): Promise<JoinGroupResult> {
  return joinGroup(groupId)
}

/** Leaves the group, or withdraws a pending request. */
export async function leaveGroup(groupId: string): Promise<CommunityActionResult> {
  const parsed = uuid.safeParse(groupId)
  if (!parsed.success) return { ok: false, error: ERROR_MESSAGES.group_not_found }
  const user = await requireAwsUser()
  return run(() => communityService.leaveGroup(user.id, parsed.data), 'We could not update your membership. Please try again.')
}

export async function approveJoinRequest(input: { groupId: string; profileId: string }): Promise<CommunityActionResult> {
  const parsed = memberSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: ERROR_MESSAGES.group_member_not_found }
  const user = await requireAwsUser()
  return run(() => communityService.approveJoinRequest(user.id, parsed.data.groupId, parsed.data.profileId), 'We could not approve this request. Please try again.')
}

export async function declineJoinRequest(input: { groupId: string; profileId: string }): Promise<CommunityActionResult> {
  const parsed = memberSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: ERROR_MESSAGES.group_member_not_found }
  const user = await requireAwsUser()
  return run(() => communityService.declineJoinRequest(user.id, parsed.data.groupId, parsed.data.profileId), 'We could not decline this request. Please try again.')
}

export async function removeMember(input: { groupId: string; profileId: string }): Promise<CommunityActionResult> {
  const parsed = memberSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: ERROR_MESSAGES.group_member_not_found }
  const user = await requireAwsUser()
  return run(() => communityService.removeMember(user.id, parsed.data.groupId, parsed.data.profileId), 'We could not remove this member. Please try again.')
}

export async function setMemberRole(input: { groupId: string; profileId: string; role: 'member' | 'admin' }): Promise<CommunityActionResult> {
  const parsed = roleSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: ERROR_MESSAGES.group_member_not_found }
  const user = await requireAwsUser()
  return run(() => communityService.setMemberRole(user.id, parsed.data.groupId, parsed.data.profileId, parsed.data.role), 'We could not change this member’s role. Please try again.')
}

/** Group admins edit the description, rules, visibility and icon. */
export async function updateGroup(input: {
  groupId: string
  description: string
  rules: string
  visibility: string
  icon: string | null
}): Promise<CommunityActionResult> {
  const parsed = groupEditSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Check the group details and try again.' }
  const user = await requireAwsUser()
  const { groupId, ...changes } = parsed.data
  return run(() => communityService.updateGroup(user.id, groupId, changes), 'We could not save the group. Please try again.')
}

/** A group admin removes a post from their group (soft delete, restorable by its author for 30 days). */
export async function removeGroupPost(postId: string): Promise<CommunityActionResult> {
  const parsed = uuid.safeParse(postId)
  if (!parsed.success) return { ok: false, error: ERROR_MESSAGES.group_post_not_found }
  const user = await requireAwsUser()
  try {
    await communityService.removeGroupPost(user.id, parsed.data)
  } catch (error) {
    return { ok: false, error: await communityErrorMessage(error, 'We could not remove this post. Please try again.') }
  }
  revalidateCommunity()
  revalidatePath('/home')
  revalidatePath('/posts/[id]', 'page')
  revalidatePath('/activities')
  return { ok: true }
}

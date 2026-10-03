'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { removeCommunityMedia, uploadCommunityMedia } from './media-service'
import type { CommunityMediaKind } from './media'
import { communityRepository } from './repository'
import { isGroupAdminRole } from './types'

export type CommunityMediaActionState = { error?: string; success?: boolean }

const groupIdSchema = z.string().uuid()

const FORBIDDEN = 'Only the owner and moderators of this group can change its images.'

/** The group's active owner or moderators (stored role 'owner' | 'admin'), or a platform administrator. */
async function canManageCommunityMedia(userId: string, groupId: string) {
  const membership = await communityRepository.getMembership(groupId, userId)
  if (membership?.status === 'active' && isGroupAdminRole(membership.role)) return true
  return canAccessPlatformAdmin(userId)
}

function revalidateCommunityMedia() {
  revalidatePath('/community')
  revalidatePath('/community/[slug]', 'page')
  revalidatePath('/admin/communities')
}

function describeError(error: unknown, fallback: string) {
  if (error instanceof Error && error.message === 'community_group_missing') return 'This group no longer exists.'
  return error instanceof Error && error.message ? error.message : fallback
}

function uploadActionFor(kind: CommunityMediaKind) {
  return async function uploadAction(
    _previousState: CommunityMediaActionState,
    formData: FormData,
  ): Promise<CommunityMediaActionState> {
    const user = await requireAwsUser()
    const groupId = groupIdSchema.safeParse(formData.get('groupId'))
    if (!groupId.success) return { error: 'This group no longer exists.' }
    const image = formData.get('image')
    if (!(image instanceof File) || image.size === 0) {
      return { error: 'Choose an image first.' }
    }
    if (!(await canManageCommunityMedia(user.id, groupId.data))) return { error: FORBIDDEN }

    try {
      await uploadCommunityMedia(groupId.data, kind, {
        type: image.type,
        size: image.size,
        bytes: new Uint8Array(await image.arrayBuffer()),
      })
    } catch (error) {
      return { error: describeError(error, 'Unable to upload image.') }
    }

    await communityRepository.insertAuditEvent(user.id, 'community.image_updated', groupId.data, { kind }).catch(() => undefined)
    revalidateCommunityMedia()
    return { success: true }
  }
}

function removeActionFor(kind: CommunityMediaKind) {
  return async function removeAction(formData: FormData): Promise<CommunityMediaActionState> {
    const user = await requireAwsUser()
    const groupId = groupIdSchema.safeParse(formData.get('groupId'))
    if (!groupId.success) return { error: 'This group no longer exists.' }
    if (!(await canManageCommunityMedia(user.id, groupId.data))) return { error: FORBIDDEN }

    try {
      await removeCommunityMedia(groupId.data, kind)
    } catch (error) {
      return { error: describeError(error, 'Unable to remove image.') }
    }

    await communityRepository.insertAuditEvent(user.id, 'community.image_removed', groupId.data, { kind }).catch(() => undefined)
    revalidateCommunityMedia()
    return { success: true }
  }
}

export const uploadCommunityCoverAction = uploadActionFor('cover')
export const uploadCommunityIconAction = uploadActionFor('icon')
export const removeCommunityCoverAction = removeActionFor('cover')
export const removeCommunityIconAction = removeActionFor('icon')

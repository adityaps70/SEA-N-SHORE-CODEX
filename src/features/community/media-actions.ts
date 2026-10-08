'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { canAccessPlatformAdmin } from '@/features/admin/access'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { removeCommunityMedia } from './media-service'
import { buildCommunityMediaKey, isCommunityMediaKind, validateCommunityImage, type CommunityMediaKind } from './media'
import { createMediaUploadUrl, deleteMediaObject, headMediaObject } from '@/lib/aws/storage'
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

export type CommunityMediaUploadTicket = CommunityMediaActionState & { uploadUrl?: string; key?: string }

/** Creates a short-lived S3 PUT URL after auth/role and image metadata validation. No image bytes cross CloudFront/WAF. */
export async function requestCommunityMediaUploadAction(input: {
  groupId: string
  kind: CommunityMediaKind
  contentType: string
  size: number
}): Promise<CommunityMediaUploadTicket> {
  const user = await requireAwsUser()
  const groupId = groupIdSchema.safeParse(input.groupId)
  if (!groupId.success || !isCommunityMediaKind(input.kind)) return { error: 'This group no longer exists.' }
  const validation = validateCommunityImage({ type: input.contentType, size: input.size })
  if (!validation.ok) return { error: validation.error }
  if (!(await canManageCommunityMedia(user.id, groupId.data))) return { error: FORBIDDEN }

  try {
    const key = buildCommunityMediaKey(groupId.data, input.kind, input.contentType)
    const uploadUrl = await createMediaUploadUrl({ key, contentType: input.contentType, contentLength: input.size })
    return { success: true, uploadUrl, key }
  } catch (error) {
    return { error: describeError(error, 'Upload failed, try again.') }
  }
}

/** Verifies the directly-uploaded S3 object, atomically swaps the DB path, then cleans up the prior object. */
export async function completeCommunityMediaUploadAction(input: {
  groupId: string
  kind: CommunityMediaKind
  key: string
}): Promise<CommunityMediaActionState> {
  const user = await requireAwsUser()
  const groupId = groupIdSchema.safeParse(input.groupId)
  if (!groupId.success || !isCommunityMediaKind(input.kind)) return { error: 'This group no longer exists.' }
  if (!(await canManageCommunityMedia(user.id, groupId.data))) return { error: FORBIDDEN }

  const expectedPrefix = `communities/${groupId.data}/${input.kind}-`
  if (!input.key.startsWith(expectedPrefix)) return { error: 'Upload failed, try again.' }

  try {
    const object = await headMediaObject(input.key)
    const validation = validateCommunityImage({
      type: object.contentType ?? '',
      size: object.contentLength ?? 0,
    })
    if (!validation.ok) {
      await deleteMediaObject(input.key).catch(() => undefined)
      return { error: validation.error }
    }

    let previousPath: string | null = null
    try {
      previousPath = await communityRepository.replaceImagePath(groupId.data, input.kind, input.key)
    } catch (error) {
      await deleteMediaObject(input.key).catch(() => undefined)
      throw error
    }
    if (previousPath && previousPath !== input.key) {
      await deleteMediaObject(previousPath).catch(() => undefined)
    }

    await communityRepository.insertAuditEvent(user.id, 'community.image_updated', groupId.data, { kind: input.kind }).catch(() => undefined)
    revalidateCommunityMedia()
    return { success: true }
  } catch (error) {
    return { error: describeError(error, 'Upload failed, try again.') }
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

export const removeCommunityCoverAction = removeActionFor('cover')
export const removeCommunityIconAction = removeActionFor('icon')

'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { removeProfileMedia, uploadProfileMedia } from './profile-media-service'
import type { ProfileMediaKind } from './profile-media-repository'

export type ProfileMediaActionState = { error?: string; success?: boolean }

function actionFor(kind: ProfileMediaKind) {
  return async function uploadAction(
    _previousState: ProfileMediaActionState,
    formData: FormData,
  ): Promise<ProfileMediaActionState> {
    const user = await requireAwsUser()
    const image = formData.get('image')
    if (!(image instanceof File) || image.size === 0) {
      return { error: 'Choose an image first.' }
    }

    try {
      await uploadProfileMedia(user.id, kind, {
        type: image.type,
        size: image.size,
        bytes: new Uint8Array(await image.arrayBuffer()),
      })
    } catch (error) {
      return { error: error instanceof Error ? error.message : 'Unable to upload image.' }
    }

    revalidatePath('/profile')
    revalidatePath('/people/[slug]', 'page')
    return { success: true }
  }
}

function removeActionFor(kind: ProfileMediaKind) {
  return async function removeAction(_formData: FormData): Promise<void> {
    const user = await requireAwsUser()
    await removeProfileMedia(user.id, kind)
    revalidatePath('/profile')
    revalidatePath('/people/[slug]', 'page')
  }
}

export const uploadAvatarAction = actionFor('avatar')
export const uploadCoverAction = actionFor('cover')
export const removeAvatarAction = removeActionFor('avatar')
export const removeCoverAction = removeActionFor('cover')

import { deleteMediaObject, putMediaObject } from '@/lib/aws/storage'
import { buildCommunityMediaKey, validateCommunityImage, type CommunityMediaKind } from './media'
import { communityRepository } from './repository'

type UploadInput = {
  type: string
  size: number
  bytes: Uint8Array
}

/**
 * Stores a community banner or photo the same way profile media is stored: validate, put the
 * new object, swap the path in `community_groups`, then delete the previous object. A database
 * failure after the put removes the freshly uploaded object so nothing is orphaned.
 */
export function createCommunityMediaService(input: {
  putObject: typeof putMediaObject
  deleteObject: typeof deleteMediaObject
  replaceImagePath: (groupId: string, kind: CommunityMediaKind, nextPath: string | null) => Promise<string | null>
}) {
  async function upload(groupId: string, kind: CommunityMediaKind, file: UploadInput) {
    const validation = validateCommunityImage(file)
    if (!validation.ok) throw new Error(validation.error)

    const key = buildCommunityMediaKey(groupId, kind, file.type)
    await input.putObject({ key, body: file.bytes, contentType: file.type })

    let previousPath: string | null = null
    try {
      previousPath = await input.replaceImagePath(groupId, kind, key)
    } catch (error) {
      await input.deleteObject(key).catch(() => undefined)
      throw error
    }

    if (previousPath && previousPath !== key) {
      await input.deleteObject(previousPath).catch(() => undefined)
    }
    return key
  }

  async function remove(groupId: string, kind: CommunityMediaKind) {
    const previousPath = await input.replaceImagePath(groupId, kind, null)
    if (previousPath) await input.deleteObject(previousPath).catch(() => undefined)
    return previousPath
  }

  return { upload, remove }
}

const productionService = createCommunityMediaService({
  putObject: putMediaObject,
  deleteObject: deleteMediaObject,
  replaceImagePath: (groupId, kind, nextPath) => communityRepository.replaceImagePath(groupId, kind, nextPath),
})

export const uploadCommunityMedia = productionService.upload
export const removeCommunityMedia = productionService.remove

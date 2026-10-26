import { deleteMediaObject, putMediaObject } from '@/lib/aws/storage'
import { prepareMediaForCdn } from '@/lib/media-cdn/prepare-media'
import { buildProfileMediaKey, validateProfileImage } from './profile-media'
import { profileMediaRepository, type ProfileMediaKind } from './profile-media-repository'

type UploadInput = {
  type: string
  size: number
  bytes: Uint8Array
}

export function createProfileMediaService(input: {
  putObject: typeof putMediaObject
  deleteObject: typeof deleteMediaObject
  replaceMediaPath: (profileId: string, kind: ProfileMediaKind, nextPath: string | null) => Promise<string | null>
  /** Round P3 (B7): writes the photo's CDN sizes before it is shown anywhere. */
  prepareForCdn?: typeof prepareMediaForCdn
}) {
  async function upload(profileId: string, kind: ProfileMediaKind, file: UploadInput) {
    const validation = validateProfileImage(file)
    if (!validation.ok) throw new Error(validation.error)

    const key = buildProfileMediaKey(profileId, kind, file.type)
    await input.putObject({ key, body: file.bytes, contentType: file.type })
    if (input.prepareForCdn) {
      try {
        await input.prepareForCdn({ key, contentType: file.type, body: file.bytes })
      } catch (error) {
        await input.deleteObject(key).catch(() => undefined)
        throw error
      }
    }

    let previousPath: string | null = null
    try {
      previousPath = await input.replaceMediaPath(profileId, kind, key)
    } catch (error) {
      await input.deleteObject(key).catch(() => undefined)
      throw error
    }

    if (previousPath && previousPath !== key) {
      await input.deleteObject(previousPath).catch(() => undefined)
    }
    return key
  }

  async function remove(profileId: string, kind: ProfileMediaKind) {
    const previousPath = await input.replaceMediaPath(profileId, kind, null)
    if (previousPath) await input.deleteObject(previousPath).catch(() => undefined)
  }

  return { upload, remove }
}

const productionService = createProfileMediaService({
  putObject: putMediaObject,
  deleteObject: deleteMediaObject,
  replaceMediaPath: profileMediaRepository.replaceMediaPath,
  prepareForCdn: prepareMediaForCdn,
})

export const uploadProfileMedia = productionService.upload
export const removeProfileMedia = productionService.remove

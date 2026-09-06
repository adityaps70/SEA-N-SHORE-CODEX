import {
  createMediaReadUrl,
  deleteMediaObject,
  putMediaObject,
} from '@/lib/aws/storage'

export async function resolveFeedMediaUrls(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map()

  const urls = new Map<string, string>()
  await Promise.all(paths.map(async (path) => {
    try {
      const signedUrl = await createMediaReadUrl(path)
      urls.set(path, signedUrl)
    } catch {
      // One unavailable object should not prevent the rest of the feed from rendering.
    }
  }))
  return urls
}

export async function uploadFeedImage(input: {
  profileId: string
  postId: string
  file: File
  extension: string
}): Promise<string> {
  const storagePath = `${input.profileId}/${input.postId}/${crypto.randomUUID()}.${input.extension}`

  try {
    const body = new Uint8Array(await input.file.arrayBuffer())
    await putMediaObject({
      key: storagePath,
      body,
      contentType: input.file.type,
    })
  } catch {
    throw new Error('feed_media_upload_failed')
  }

  return storagePath
}

export async function removeFeedImage(storagePath: string): Promise<void> {
  await deleteMediaObject(storagePath)
}

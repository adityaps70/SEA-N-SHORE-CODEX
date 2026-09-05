import { createServerSupabaseClient } from '@/lib/supabase/server'

const FEED_MEDIA_BUCKET = 'post-media'

export async function resolveFeedMediaUrls(paths: string[]): Promise<Map<string, string>> {
  if (!paths.length) return new Map()
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.storage.from(FEED_MEDIA_BUCKET).createSignedUrls(paths, 3600)
  if (error) return new Map()

  const urls = new Map<string, string>()
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) urls.set(item.path, item.signedUrl)
  }
  return urls
}

export async function uploadFeedImage(input: {
  profileId: string
  postId: string
  file: File
  extension: string
}): Promise<string> {
  const storagePath = `${input.profileId}/${input.postId}/${crypto.randomUUID()}.${input.extension}`
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.storage
    .from(FEED_MEDIA_BUCKET)
    .upload(storagePath, input.file, { contentType: input.file.type, upsert: false })
  if (error) throw new Error('feed_media_upload_failed')
  return storagePath
}

export async function removeFeedImage(storagePath: string): Promise<void> {
  const supabase = await createServerSupabaseClient()
  await supabase.storage.from(FEED_MEDIA_BUCKET).remove([storagePath])
}

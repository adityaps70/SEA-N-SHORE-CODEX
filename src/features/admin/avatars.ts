import { createMediaImageSrc } from '@/lib/images/media-image-src'

type SignUrl = (key: string, expiresInSeconds: number) => Promise<string>

/**
 * Adds a short-lived signed photo URL to each admin list row, the same way
 * member profiles are signed elsewhere. The storage paths come with the list
 * query, so this is one batch of local signatures and no extra database reads.
 * A photo that cannot be signed falls back to initials (null).
 */
export async function withAdminAvatarUrls<T extends { avatarPath?: string | null }>(
  rows: readonly T[],
  signUrl: SignUrl = createMediaImageSrc,
): Promise<Array<T & { avatarUrl: string | null }>> {
  const paths = [...new Set(rows.map((row) => row.avatarPath?.trim()).filter((path): path is string => Boolean(path)))]
  const signed = new Map(await Promise.all(paths.map(async (path) => {
    try {
      return [path, await signUrl(path, 900)] as const
    } catch {
      return [path, null] as const
    }
  })))
  return rows.map((row) => ({ ...row, avatarUrl: signed.get(row.avatarPath?.trim() ?? '') ?? null }))
}

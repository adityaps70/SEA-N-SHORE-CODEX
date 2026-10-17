import { createMediaImageSrc } from '@/lib/images/media-image-src'
import type { AboutPageContent } from './schemas'

/**
 * Round H (H7): signed links for the About page images (partner logos and people's photos) an
 * administrator uploaded to the media bucket, by storage path. An image that cannot be signed is left
 * out (the page then shows the name or initials).
 */
export async function signedAboutImageUrls(content: AboutPageContent, sign: (path: string) => Promise<string> = createMediaImageSrc) {
  const paths = [...content.founders, ...content.team].map((person) => person.photoPath).concat(content.partners.map((partner) => partner.logoPath))
  const unique = [...new Set(paths.filter((path): path is string => Boolean(path)))]
  const entries = await Promise.all(unique.map(async (path) => {
    try {
      return [path, await sign(path)] as const
    } catch {
      return null
    }
  }))
  return Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => entry !== null))
}

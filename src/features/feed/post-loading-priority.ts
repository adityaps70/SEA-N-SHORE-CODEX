/**
 * How eagerly a post card fetches its photos. The first two posts of a list are on (or just
 * below) the first screen, so their author photos and first image start downloading at once
 * instead of waiting for lazy loading; the very first post's image is also fetched with high
 * priority. Everything further down stays lazy.
 */
export type PostLoadingPriority = 'lead' | 'eager'

export function postLoadingPriority(index: number): PostLoadingPriority | undefined {
  if (index === 0) return 'lead'
  if (index === 1) return 'eager'
  return undefined
}

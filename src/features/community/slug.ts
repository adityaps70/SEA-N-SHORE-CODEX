import { GROUP_SLUG_MAX_LENGTH } from './types'

/** Lower-case ASCII slug from a group name: letters and digits, single hyphens, at most 80 characters. */
export function groupSlugFromName(name: string) {
  const ascii = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const trimmed = ascii.slice(0, GROUP_SLUG_MAX_LENGTH).replace(/-+$/g, '')
  return trimmed || 'group'
}

/**
 * The base slug when it is free, otherwise the first `base-2`, `base-3`, … not in `taken`.
 * Suffixes keep the result within the 80-character limit.
 */
export function uniqueGroupSlug(base: string, taken: Iterable<string>) {
  const used = new Set(taken)
  if (!used.has(base)) return base
  for (let counter = 2; counter < 10_000; counter += 1) {
    const suffix = `-${counter}`
    const candidate = `${base.slice(0, GROUP_SLUG_MAX_LENGTH - suffix.length).replace(/-+$/g, '')}${suffix}`
    if (!used.has(candidate)) return candidate
  }
  throw new Error('community_group_slug_exhausted')
}

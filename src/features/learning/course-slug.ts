/**
 * Owner (15 Nov): a new course's URL slug follows its title as the trainer types (lowercase, hyphens, no special
 * characters), until they edit the slug by hand. A slug another course already has gets -2, -3, … (the server picks
 * the first free one). Existing courses keep their slugs.
 */
export const COURSE_SLUG_MAX = 120

/** "SIRE 2.0 Readiness: Tanker Officers!" → "sire-2-0-readiness-tanker-officers". Empty when nothing is left. */
export function slugifyCourseTitle(title: string): string {
  const slug = title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (slug.length <= COURSE_SLUG_MAX) return slug
  // Cut at a word boundary, leaving room for a "-NN" suffix.
  const cut = slug.slice(0, COURSE_SLUG_MAX - 4)
  const boundary = cut.lastIndexOf('-')
  return (boundary > 40 ? cut.slice(0, boundary) : cut).replace(/-+$/g, '')
}

/** The base itself if free, else base-2, base-3, … (within the slug length limit). */
export function firstFreeSlug(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  for (let n = 2; n < 10_000; n += 1) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, COURSE_SLUG_MAX - suffix.length).replace(/-+$/g, '')}${suffix}`
    if (!taken.has(candidate)) return candidate
  }
  return base
}

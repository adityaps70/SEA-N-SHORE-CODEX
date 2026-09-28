/**
 * Phone search chips (round 8). Desktop keeps showing every vertical; below md the chips pick one
 * vertical, and "All" shows the first few results of each with a "See all …" link to its chip.
 * Posts are not searchable yet, so there is no Posts chip.
 */
export const SEARCH_VERTICALS = ['people', 'jobs', 'organizations', 'courses', 'events'] as const
export type SearchVertical = (typeof SEARCH_VERTICALS)[number]
export type SearchChip = 'all' | SearchVertical

export const SEARCH_CHIP_LABELS: Record<SearchChip, string> = {
  all: 'All',
  people: 'People',
  jobs: 'Jobs',
  organizations: 'Organizations',
  courses: 'Courses',
  events: 'Events',
}

/** Results per vertical: desktop shows 6; a selected phone chip shows up to 20. */
export const DESKTOP_RESULTS_PER_VERTICAL = 6
export const PHONE_ALL_RESULTS_PER_VERTICAL = 3
export const PHONE_CHIP_RESULTS = 20

export function parseSearchChip(value: string | string[] | undefined): SearchChip {
  const raw = Array.isArray(value) ? value[0] : value
  return (SEARCH_VERTICALS as readonly string[]).includes(raw ?? '') ? raw as SearchVertical : 'all'
}

export function searchChipHref(query: string, chip: SearchChip) {
  const params = new URLSearchParams()
  params.set('q', query)
  if (chip !== 'all') params.set('type', chip)
  return `/search?${params.toString()}`
}

/** How many results of a vertical to load into the page for the current chip. */
export function resultLimit(chip: SearchChip, vertical: SearchVertical) {
  return chip === vertical ? PHONE_CHIP_RESULTS : DESKTOP_RESULTS_PER_VERTICAL
}

/** Classes for one result: desktop always shows the first 6; phones show 3 under All, all of a chosen vertical. */
export function resultItemClass(chip: SearchChip, index: number) {
  const classes: string[] = []
  if (index >= DESKTOP_RESULTS_PER_VERTICAL) classes.push('md:hidden')
  if (chip === 'all' && index >= PHONE_ALL_RESULTS_PER_VERTICAL) classes.push('max-md:hidden')
  return classes.join(' ') || undefined
}

/** A vertical's whole section is hidden on phones when another chip is selected. */
export function sectionPhoneClass(chip: SearchChip, vertical: SearchVertical) {
  return chip !== 'all' && chip !== vertical ? 'max-md:hidden' : ''
}

export function resultCountLabel(count: number, query: string) {
  return `${count} result${count === 1 ? '' : 's'} for “${query}”`
}

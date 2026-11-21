/**
 * Round GP Part E: the admin sections a platform administrator can open to a country admin, each as "view" or
 * "act" (act includes view). Every section is limited to the country admin's own countries. Kept free of server
 * imports: the Admin › Country admins form and the admin navigation use it too.
 */
export const COUNTRY_ADMIN_SECTIONS = [
  'overview', 'organizations', 'members', 'learning', 'events', 'moderation', 'communities', 'verification', 'access',
] as const

export type CountryAdminSection = (typeof COUNTRY_ADMIN_SECTIONS)[number]
export type CountryAdminLevel = 'view' | 'act'
export type CountryAdminPermissions = Partial<Record<CountryAdminSection, CountryAdminLevel>>

type SectionInfo = {
  label: string
  /** Where the section starts in the admin console. */
  href: string
  /** What "view" and "act" allow, for the Admin › Country admins form. */
  view: string
  act: string | null
}

export const COUNTRY_ADMIN_SECTION_INFO: Record<CountryAdminSection, SectionInfo> = {
  overview: { label: 'Overview', href: '/admin', view: 'Counts for their countries, in the sections they have', act: null },
  organizations: { label: 'Organizations', href: '/admin/organizations?view=queue', view: 'Queue, directory and reviews', act: 'Approve, reject and request changes' },
  members: { label: 'Members by country', href: '/admin/countries', view: 'Their countries’ member and organization numbers', act: null },
  learning: { label: 'Learning', href: '/admin/learning', view: 'Trainer applications, course reviews, ratings and replies', act: 'Decide trainer applications and course reviews; approve or reject ratings; hide or show replies' },
  events: { label: 'Events', href: '/admin/events', view: 'Their countries’ events and reports on them', act: 'Cancel or restore an event through a report' },
  moderation: { label: 'Moderation', href: '/admin/moderation', view: 'Reports on their countries’ posts, comments, jobs, events, groups and ratings', act: 'Review, dismiss, resolve, remove and restore (never on member profiles)' },
  communities: { label: 'Communities', href: '/admin/communities', view: 'Their countries’ groups', act: 'Edit details, archive and unarchive' },
  verification: { label: 'Verification', href: '/admin/verifications', view: 'Recruiter and event-host applications', act: 'Approve or reject' },
  access: { label: 'Access requests', href: '/admin/access', view: 'Requests waiting on Sea N Shore, and their history', act: 'Approve (non-admin roles only) or reject' },
}

/**
 * The sections whose country-admin pages exist in this release. A platform administrator can only tick these; the
 * database allows every section, so a later release just adds to this list.
 */
export const LIVE_COUNTRY_ADMIN_SECTIONS: readonly CountryAdminSection[] = ['overview', 'organizations', 'members', 'learning', 'verification', 'access']

/** Sections that only ever have "view" (no decisions). */
export const VIEW_ONLY_SECTIONS: readonly CountryAdminSection[] = ['overview', 'members']

/** What a new country admin starts with (owner, 21 Nov): Organizations, with decisions. */
export const DEFAULT_COUNTRY_ADMIN_PERMISSIONS: CountryAdminPermissions = { organizations: 'act' }

/** What every country admin had before sections existed (and keeps until a platform administrator changes it). */
export const LEGACY_COUNTRY_ADMIN_PERMISSIONS: CountryAdminPermissions = { organizations: 'act', members: 'view' }

export function isCountryAdminSection(value: unknown): value is CountryAdminSection {
  return typeof value === 'string' && (COUNTRY_ADMIN_SECTIONS as readonly string[]).includes(value)
}

/** True when the permissions allow the section at this level ("act" includes "view"). */
export function allows(permissions: CountryAdminPermissions, section: CountryAdminSection, level: CountryAdminLevel = 'view') {
  const granted = permissions[section]
  return level === 'view' ? granted === 'view' || granted === 'act' : granted === 'act'
}

/**
 * Cleans a permission set from the form or the database: only known sections, "act" only where a section has
 * decisions, and at least one section. Returns null when nothing valid is left.
 */
export function normalisePermissions(input: Partial<Record<string, unknown>>): CountryAdminPermissions | null {
  const result: CountryAdminPermissions = {}
  for (const section of COUNTRY_ADMIN_SECTIONS) {
    const level = input[section]
    if (level !== 'view' && level !== 'act') continue
    result[section] = level === 'act' && VIEW_ONLY_SECTIONS.includes(section) ? 'view' : level
  }
  return Object.keys(result).length ? result : null
}

/** The first page a country admin should land on: the Overview when they have it, else their first section. */
export function countryAdminHome(permissions: CountryAdminPermissions): string | null {
  const first = COUNTRY_ADMIN_SECTIONS.find((section) => LIVE_COUNTRY_ADMIN_SECTIONS.includes(section) && allows(permissions, section))
  return first ? COUNTRY_ADMIN_SECTION_INFO[first].href : null
}

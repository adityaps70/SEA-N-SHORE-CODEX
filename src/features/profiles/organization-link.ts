import { z } from 'zod'

/** An organization page on Sea N Shore that a profile's current organization links to. */
export type LinkedOrganization = {
  id: string
  slug: string
  name: string
  /** Same-origin logo URL, or null when the organization has no logo. */
  logoUrl: string | null
  verified: boolean
}

/** One type-ahead result from the organization picker search. */
export type OrganizationSearchResult = LinkedOrganization & {
  /** Display label for the organization type, e.g. "Ship manager". */
  type: string | null
  location: string | null
}

export const ORGANIZATION_SEARCH_MIN_LENGTH = 2
export const ORGANIZATION_SEARCH_MAX_LENGTH = 80
export const ORGANIZATION_SEARCH_LIMIT = 8

export function organizationLogoUrl(companyId: string, hasLogo: boolean) {
  return hasLogo ? `/api/company-logo/${companyId}` : null
}

export function organizationPageHref(slug: string) {
  return `/organizations/${slug}`
}

/**
 * Link to the existing "Register a new organization" flow with the name filled
 * in. Sea N Shore reviews every new organization before its page goes live.
 */
export function createOrganizationHref(name?: string | null) {
  const params = new URLSearchParams({ register: '1' })
  const trimmed = name?.trim().slice(0, 160)
  if (trimmed) params.set('name', trimmed)
  return `/organizations?${params.toString()}#register-organization`
}

export function normalizeOrganizationSearchTerm(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim().slice(0, ORGANIZATION_SEARCH_MAX_LENGTH)
}

/** Optional organization id from a form: empty means "not linked". */
export const optionalOrganizationIdSchema = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return undefined
    const normalized = value.trim()
    return normalized || undefined
  },
  z.string().uuid('Choose the organization again from the list, or clear it and type the name.').optional(),
)

type LinkedOrganizationJson = {
  id?: unknown
  slug?: unknown
  name?: unknown
  has_logo?: unknown
  verified?: unknown
}

/** Maps the `current_organization` JSON object selected with a profile. */
export function mapLinkedOrganization(value: unknown): LinkedOrganization | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as LinkedOrganizationJson
  if (typeof row.id !== 'string' || typeof row.slug !== 'string' || typeof row.name !== 'string') return null
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    logoUrl: organizationLogoUrl(row.id, row.has_logo === true),
    verified: row.verified === true,
  }
}

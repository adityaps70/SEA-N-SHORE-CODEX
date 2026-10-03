import { z } from 'zod'
import {
  ORGANIZATION_TYPE_CODES,
  getOrganizationType,
  type OrganizationTypeCode,
} from './organization-types'

/**
 * Unclaimed organizations: a member who "just works there" can add an
 * organization that is not on Sea N Shore yet. The page exists so colleagues can
 * link to it, but nobody manages it. It cannot publish jobs, events, courses or
 * organization posts until someone who owns or manages it claims the page and
 * Sea N Shore verifies the claim.
 */
export const ORGANIZATION_CLAIM_STATUSES = ['claimed', 'unclaimed'] as const
export type OrganizationClaimStatus = (typeof ORGANIZATION_CLAIM_STATUSES)[number]

/** New unclaimed organizations one member may add in 24 hours. */
export const UNCLAIMED_ORGANIZATIONS_PER_DAY = 5

/**
 * SQL for the claim status of a `public.companies` row. It reads the column
 * through the row's JSON so screens keep working (as "claimed") on a database
 * where migration 0050 has not run yet.
 */
export function organizationClaimStatusSql(alias: string) {
  return `coalesce(to_jsonb(${alias}) ->> 'claim_status', 'claimed')`
}

/** Collapse whitespace so "Oceanic  Ship  Management " and "Oceanic Ship Management" are one name. */
export function normalizeOrganizationName(value: unknown) {
  if (typeof value !== 'string') return ''
  return value.replace(/\s+/g, ' ').trim()
}

/** Case-insensitive key used to spot duplicate organization names. */
export function organizationNameKey(value: unknown) {
  return normalizeOrganizationName(value).toLocaleLowerCase('en')
}

export function sameOrganizationName(left: unknown, right: unknown) {
  const key = organizationNameKey(left)
  return key.length > 0 && key === organizationNameKey(right)
}

const optionalWebsite = z.preprocess(
  (value) => {
    if (typeof value !== 'string') return null
    const trimmed = value.trim()
    if (!trimmed) return null
    // People often type "company.com"; store it as a full address.
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  },
  z.string()
    .url('Enter the website address, for example company.com.')
    .max(320, 'Keep the website address to 320 characters or fewer.')
    .refine((value) => /^https?:\/\/[^/\s]+\.[^/\s]+/i.test(value), 'Enter the website address, for example company.com.')
    .nullable(),
)

/** "I just work there": the small form that adds an unclaimed organization. */
export const unclaimedOrganizationSchema = z.object({
  name: z.preprocess(
    normalizeOrganizationName,
    z.string()
      .min(2, 'Enter the organization name using at least 2 characters.')
      .max(160, 'Keep the organization name to 160 characters or fewer.'),
  ),
  organizationType: z.enum(ORGANIZATION_TYPE_CODES as [OrganizationTypeCode, ...OrganizationTypeCode[]], {
    message: 'Choose the type or industry that fits best.',
  }),
  location: z.preprocess(
    (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''),
    z.string()
      .min(2, 'Enter the city and country, for example Mumbai, India.')
      .max(120, 'Keep the location to 120 characters or fewer.'),
  ),
  website: optionalWebsite,
})

/** What the "I just work there" form sends; validated on the server. */
export type UnclaimedOrganizationInput = {
  name: string
  organizationType: string
  location: string
  website?: string | null
}
export type ParsedUnclaimedOrganizationInput = z.output<typeof unclaimedOrganizationSchema>

/** Label stored in companies.company_type for search and older screens. */
export function unclaimedOrganizationTypeLabel(code: OrganizationTypeCode) {
  return getOrganizationType(code).label
}

/** URL-safe slug for a new unclaimed page: the name plus a short random suffix. */
export function unclaimedOrganizationSlug(name: string, random: () => string = () => crypto.randomUUID()) {
  const suffix = random().replace(/[^a-z0-9]/gi, '').slice(0, 6).toLowerCase() || 'page'
  const base = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'organization'
  const maximumBaseLength = Math.max(1, 80 - suffix.length - 1)
  return `${base.slice(0, maximumBaseLength).replace(/-+$/g, '')}-${suffix}`
}

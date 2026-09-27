/**
 * Shared helpers for the organization page (cover, tagline, company size,
 * media URLs). Pure functions: safe to import from server and client code.
 */

export const COMPANY_SIZES = [
  { value: '1-10', label: '1–10 employees' },
  { value: '11-50', label: '11–50 employees' },
  { value: '51-200', label: '51–200 employees' },
  { value: '201-500', label: '201–500 employees' },
  { value: '501-1000', label: '501–1,000 employees' },
  { value: '1001-5000', label: '1,001–5,000 employees' },
  { value: '5001-10000', label: '5,001–10,000 employees' },
  { value: '10001+', label: '10,001+ employees' },
] as const

export type CompanySize = (typeof COMPANY_SIZES)[number]['value']
export const COMPANY_SIZE_VALUES = COMPANY_SIZES.map((size) => size.value) as CompanySize[]

export const ORGANIZATION_PAGE_TABS = [
  { id: 'home', label: 'Home' },
  { id: 'about', label: 'About' },
  { id: 'posts', label: 'Posts' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'events', label: 'Events' },
  { id: 'courses', label: 'Courses' },
  { id: 'people', label: 'People' },
] as const

export type OrganizationPageTab = (typeof ORGANIZATION_PAGE_TABS)[number]['id']

export function parseOrganizationPageTab(value: string | string[] | undefined): OrganizationPageTab {
  const first = Array.isArray(value) ? value[0] : value
  return ORGANIZATION_PAGE_TABS.find((tab) => tab.id === first)?.id ?? 'home'
}

/** URL of one tab; Home is the bare page URL. */
export function organizationTabHref(slug: string, tab: OrganizationPageTab) {
  return tab === 'home' ? `/organizations/${slug}` : `/organizations/${slug}?tab=${tab}`
}

export const MANAGE_SECTIONS = ['overview', 'requests'] as const
export type ManageSection = (typeof MANAGE_SECTIONS)[number]

export function parseManageSection(value: string | string[] | undefined): ManageSection {
  const first = Array.isArray(value) ? value[0] : value
  return first === 'requests' ? 'requests' : 'overview'
}

export function organizationManageHref(slug: string, section: ManageSection = 'overview') {
  return section === 'overview' ? `/organizations/${slug}/manage` : `/organizations/${slug}/manage?section=${section}`
}

export const TAGLINE_MAX_LENGTH = 160
export const MAX_SPECIALTIES = 20

export const BRANDING_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const
export const MAX_BRANDING_IMAGE_BYTES = 5 * 1024 * 1024
/** Server actions accept up to 6 MB per save, including the text fields. */
export const MAX_BRANDING_UPLOAD_BYTES = 5.5 * 1024 * 1024

type ChosenImage = { size: number; type: string } | null | undefined

/** Checks chosen logo and cover files before the form is sent; returns a message or null. */
export function brandingImagesProblem(logo: ChosenImage, cover: ChosenImage) {
  for (const [file, label] of [[logo, 'The logo'], [cover, 'The cover image']] as const) {
    if (!file || file.size === 0) continue
    if (!(BRANDING_IMAGE_TYPES as readonly string[]).includes(file.type)) return `${label} must be a JPG, PNG or WebP image.`
    if (file.size > MAX_BRANDING_IMAGE_BYTES) return `${label} is larger than 5 MB. Choose a smaller image.`
  }
  if ((logo?.size ?? 0) + (cover?.size ?? 0) > MAX_BRANDING_UPLOAD_BYTES) {
    return 'The logo and cover image together are larger than 5.5 MB. Save one image first, then choose the other and save again.'
  }
  return null
}

export function isCompanySize(value: unknown): value is CompanySize {
  return typeof value === 'string' && (COMPANY_SIZE_VALUES as string[]).includes(value)
}

export function companySizeLabel(value: string | null | undefined) {
  return COMPANY_SIZES.find((size) => size.value === value)?.label ?? null
}

/** The saved tagline, or the first line of the description, cut to tagline length. */
export function organizationTagline(input: { tagline?: string | null; description?: string | null }) {
  const saved = input.tagline?.trim()
  if (saved) return saved
  const firstLine = input.description?.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
  if (!firstLine) return null
  if (firstLine.length <= TAGLINE_MAX_LENGTH) return firstLine
  return `${firstLine.slice(0, TAGLINE_MAX_LENGTH - 1).trimEnd()}…`
}

/**
 * Version suffix taken from the stored object key (each upload gets a new random
 * key), so browsers fetch the new image right after it changes.
 */
function version(path: string) {
  const name = path.split('/').pop() ?? path
  return encodeURIComponent(name.slice(-24))
}

export function organizationLogoUrl(company: { id: string; logoPath: string | null }) {
  return company.logoPath ? `/api/company-logo/${company.id}?v=${version(company.logoPath)}` : null
}

export function organizationCoverUrl(company: { id: string; coverPath: string | null }) {
  return company.coverPath ? `/api/company-cover/${company.id}?v=${version(company.coverPath)}` : null
}

export function websiteLabel(website: string) {
  return website.replace(/^https?:\/\//, '').replace(/\/$/, '')
}

export function organizationInitials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'SN'
}

export function formatCount(value: number) {
  return value.toLocaleString('en-IN')
}

export function followerLabel(count: number) {
  return `${formatCount(count)} ${count === 1 ? 'follower' : 'followers'}`
}

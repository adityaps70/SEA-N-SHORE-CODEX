import type { Metadata } from 'next'
import { indexableMetadata, metaDescription } from '@/lib/seo/meta'
import { organizationLogoUrl } from './organization-page-profile'
import type { OrganizationWorkspace } from './workspace-repository'

/**
 * Round H (H5): search metadata and schema.org Organization data for an organization page
 * (/organizations/<slug>). The canonical address drops the ?tab= query, so every tab points at one page.
 */
type OrganizationSeoInput = Pick<
  OrganizationWorkspace,
  'id' | 'slug' | 'name' | 'logoPath' | 'website' | 'description' | 'tagline' | 'officeLocations'
>

export function organizationPath(slug: string) {
  return `/organizations/${slug}`
}

/** The "About" description, else the tagline, as one search snippet. */
export function organizationMetaDescription(organization: Pick<OrganizationSeoInput, 'description' | 'tagline'>) {
  return metaDescription(organization.description, organization.tagline)
}

export function organizationMetadata(organization: OrganizationSeoInput): Metadata {
  return indexableMetadata({
    title: organization.name,
    description: organizationMetaDescription(organization),
    path: organizationPath(organization.slug),
  })
}

/** "Mumbai, Maharashtra, India" → locality Mumbai, country India; a single part is the locality. */
export function organizationAddress(location: string | null | undefined) {
  const parts = (location ?? '').split(',').map((part) => part.trim()).filter(Boolean)
  if (!parts.length) return null
  return {
    '@type': 'PostalAddress',
    addressLocality: parts[0],
    ...(parts.length > 1 ? { addressCountry: parts[parts.length - 1] } : {}),
  }
}

function webAddress(value: string | null | undefined) {
  if (!value) return null
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null
  } catch {
    return null
  }
}

export function organizationJsonLd(organization: OrganizationSeoInput, origin: string) {
  const logo = organizationLogoUrl(organization)
  const website = webAddress(organization.website)
  const address = organizationAddress(organization.officeLocations[0])
  const description = organizationMetaDescription(organization)
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: organization.name,
    url: `${origin}${organizationPath(encodeURIComponent(organization.slug))}`,
    ...(logo ? { logo: `${origin}${logo}` } : {}),
    ...(website ? { sameAs: [website] } : {}),
    ...(address ? { address } : {}),
    ...(description ? { description } : {}),
  }
}

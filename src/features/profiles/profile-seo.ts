import type { Metadata } from 'next'
import { isMediaImageLink } from '@/lib/images/media-image-route'
import { cdnImageUrlForWidth, isCdnImageUrl } from '@/lib/media-cdn/cdn-url'
import { indexableMetadata, metaDescription } from '@/lib/seo/meta'
import type { PublicProfile } from './types'

/**
 * Round H (H5): search metadata for public member profiles (/people/<slug>).
 *
 * A profile is listed by search engines only when its owner turned on "Let search engines show my
 * profile" (Settings › Privacy). Without that the page asks not to be indexed or followed and carries no
 * structured data. Person data holds public profile fields only: never an email address or phone number.
 */
export function profilePath(slug: string) {
  return `/people/${slug}`
}

export function profileTitle(profile: Pick<PublicProfile, 'fullName' | 'headline'>) {
  return profile.headline ? `${profile.fullName} · ${profile.headline}` : profile.fullName
}

/**
 * The avatar's stable first-party link, or (Round P3) its largest CDN size, which is signed for 30
 * to 60 days like that link; short-lived signed storage URLs are never published.
 */
export function publicAvatarPath(profile: Pick<PublicProfile, 'avatarUrl'>) {
  if (!profile.avatarUrl) return null
  if (isCdnImageUrl(profile.avatarUrl)) return cdnImageUrlForWidth(profile.avatarUrl, 1600)
  return isMediaImageLink(profile.avatarUrl) ? profile.avatarUrl : null
}

export function profileMetadata(profile: PublicProfile, options: { allowIndexing: boolean }): Metadata {
  const title = profileTitle(profile)
  const description = metaDescription(profile.summary, profile.headline)
  if (!options.allowIndexing) {
    return { title, ...(description ? { description } : {}), robots: { index: false, follow: false } }
  }
  const avatar = publicAvatarPath(profile)
  return indexableMetadata({ title, description, path: profilePath(profile.slug), ...(avatar ? { images: [avatar] } : {}) })
}

export function personJsonLd(profile: PublicProfile, origin: string) {
  const avatar = publicAvatarPath(profile)
  const jobTitle = profile.rank?.trim() || profile.headline?.trim() || null
  const employer = profile.currentOrganization?.name?.trim() || profile.currentCompany?.trim() || null
  const description = metaDescription(profile.summary, profile.headline)
  return {
    '@context': 'https://schema.org',
    '@type': 'Person',
    name: profile.fullName,
    url: `${origin}${profilePath(encodeURIComponent(profile.slug))}`,
    ...(jobTitle ? { jobTitle } : {}),
    ...(description ? { description } : {}),
    ...(avatar ? { image: `${origin}${avatar}` } : {}),
    ...(employer ? { worksFor: { '@type': 'Organization', name: employer } } : {}),
  }
}

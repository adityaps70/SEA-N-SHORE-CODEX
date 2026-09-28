import Link from 'next/link'
import type { FeedAuthor, FeedOrganization } from '../types'

export function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

/** Profile page of a member. The single place feed surfaces build a person's link. */
export function profileHref(slug: string) {
  return `/people/${slug}`
}

export function organizationHref(slug: string) {
  return `/organizations/${slug}`
}

/** Where the name and photo of a post lead: its organization's page, or the author's profile. */
export function publishedAsHref(post: { author: Pick<FeedAuthor, 'slug'>; organization?: Pick<FeedOrganization, 'slug'> | null }) {
  return post.organization ? organizationHref(post.organization.slug) : profileHref(post.author.slug)
}

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500/50 focus-visible:ring-offset-2'

/** A member's profile photo (or initials) that opens their profile. */
export function AuthorAvatarLink({ author, className }: {
  author: Pick<FeedAuthor, 'slug' | 'fullName' | 'avatarUrl'>
  /** Size, shape and text size of the photo box, e.g. "size-11 rounded-2xl text-sm". */
  className: string
}) {
  return (
    <Link
      href={profileHref(author.slug)}
      aria-label={`View ${author.fullName}'s profile`}
      className={`grid shrink-0 place-items-center overflow-hidden bg-mist-100 font-semibold text-navy-950 ring-1 ring-mist-100 transition hover:opacity-90 ${focusRing} ${className}`}
    >
      {author.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- signed profile photo URLs are short-lived
        <img src={author.avatarUrl} alt={`${author.fullName}'s profile photo`} loading="lazy" className="h-full w-full object-cover" />
      ) : <span aria-hidden="true">{initials(author.fullName)}</span>}
    </Link>
  )
}

/** Logo (or initials) of the organization a post was published as, opening its page. */
export function OrganizationLogoLink({ organization, className }: {
  organization: FeedOrganization
  className: string
}) {
  return (
    <Link
      href={organizationHref(organization.slug)}
      aria-label={`View ${organization.name}'s page`}
      className={`grid shrink-0 place-items-center overflow-hidden bg-navy-950 text-xs font-black text-white ring-1 ring-mist-100 transition hover:opacity-90 ${focusRing} ${className}`}
    >
      {organization.logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element -- organization logos come from the signed-in first-party logo route
        <img src={organization.logoUrl} alt={`${organization.name} logo`} loading="lazy" className="h-full w-full bg-white object-contain p-1" />
      ) : <span aria-hidden="true">{initials(organization.name)}</span>}
    </Link>
  )
}

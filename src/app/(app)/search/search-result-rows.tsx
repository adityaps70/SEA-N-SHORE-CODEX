import { MediaImage } from '@/components/ui/media-image'
import Link from 'next/link'
import { BadgeCheck, BookOpen, Building2, Hash, Lock } from 'lucide-react'
import { GroupIconTile } from '@/features/community/components/group-icon-tile'
import { groupHref } from '@/features/community/types'
import { hashtagHref } from '@/features/hashtags/parse'
import { PersonCardActions } from '@/features/network/components/person-card-actions'
import type { NetworkProfile } from '@/features/network/types'

/*
 * Phone search results (round 8, below md only): compact rows with a thin divider, instead of
 * the desktop cards. Each vertical renders these in a `md:hidden` list next to its desktop grid.
 */

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

/** Divided list wrapper for phone result rows. */
export const PHONE_RESULT_LIST_CLASS = 'divide-y divide-mist-100 md:hidden'

/**
 * Person: 48px photo, name, headline, then rank · organization · location, the relationship's
 * primary action (Connect, Pending, Accept or Message) and a "…" with Follow, View profile,
 * Report and Block — the same actions as the network cards.
 */
export function SearchPersonRow({ profile, className = '' }: { profile: NetworkProfile; className?: string }) {
  const context = [profile.rank, profile.currentCompany, profile.location].filter(Boolean).join(' · ')
  const headline = profile.headline || context || 'Maritime professional'
  const profileInitials = (
    <span className="grid size-12 place-items-center rounded-full bg-ocean-50 text-[15px] font-semibold text-ocean-800">{initials(profile.fullName)}</span>
  )
  return (
    <li className={`flex items-center gap-3 py-3 first:pt-0 ${className}`}>
      <Link href={`/people/${profile.slug}`} className="shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500" aria-label={`View ${profile.fullName} profile`}>
        {profile.avatarUrl ? (
          <MediaImage avatar src={profile.avatarUrl} alt="" width={48} height={48} sizes="48px" className="size-12 rounded-full object-cover ring-1 ring-mist-100" fallback={profileInitials} />
        ) : profileInitials}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/people/${profile.slug}`} className="block truncate text-[15px] font-semibold text-navy-950 hover:underline">
          {profile.fullName}
        </Link>
        <p className="truncate text-[13px] text-muted">{headline}</p>
        {profile.headline && context ? <p className="truncate text-xs text-muted">{context}</p> : null}
      </div>
      <div className="shrink-0">
        <PersonCardActions profileId={profile.id} slug={profile.slug} fullName={profile.fullName} initialRelationship={profile.relationship} layout="row" />
      </div>
    </li>
  )
}

type OrganizationResult = { id: string; slug: string; name: string; verified: boolean; companyType: string | null }

/** Organization: logo tile, name (+ verified), type. */
export function SearchOrganizationRow({ organization, className = '' }: { organization: OrganizationResult; className?: string }) {
  return (
    <li className={`first:pt-0 ${className}`}>
      <Link href={`/organizations/${organization.slug}`} className="flex min-h-14 items-center gap-3 py-3 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
          <Building2 aria-hidden="true" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold text-navy-950">{organization.name}</span>
            {organization.verified ? <BadgeCheck aria-label="Verified" className="size-4 shrink-0 text-teal-500" /> : null}
          </span>
          <span className="block truncate text-[13px] text-muted">{organization.companyType ?? 'Maritime organization'}</span>
        </span>
      </Link>
    </li>
  )
}

type HashtagResult = { tag: string; postCount: number }

export function hashtagPostCountLabel(postCount: number) {
  return postCount === 1 ? '1 post' : `${postCount.toLocaleString('en-IN')} posts`
}

/** Hashtag: "#" tile, tag, post count (round 9B). */
export function SearchHashtagRow({ hashtag, className = '' }: { hashtag: HashtagResult; className?: string }) {
  return (
    <li className={`first:pt-0 ${className}`}>
      <Link href={hashtagHref(hashtag.tag)} className="flex min-h-14 items-center gap-3 py-3 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
          <Hash aria-hidden="true" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[15px] font-semibold text-navy-950">#{hashtag.tag}</span>
          <span className="block truncate text-[13px] text-muted">{hashtagPostCountLabel(hashtag.postCount)}</span>
        </span>
      </Link>
    </li>
  )
}

type GroupResult = { id: string; slug: string; name: string; description: string; icon: string | null; iconUrl?: string | null; visibility: 'public' | 'private'; memberCount: number }

/** Community group (round 9B): photo or icon tile, name (+ lock for private groups), member count · one-line description. */
export function SearchGroupRow({ group, className = '' }: { group: GroupResult; className?: string }) {
  const members = `${group.memberCount} ${group.memberCount === 1 ? 'member' : 'members'}`
  return (
    <li className={`first:pt-0 ${className}`}>
      <Link href={groupHref(group.slug)} className="flex min-h-14 items-center gap-3 py-3 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500">
        <GroupIconTile icon={group.icon} iconUrl={group.iconUrl ?? null} size="md" />
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[15px] font-semibold text-navy-950">{group.name}</span>
            {group.visibility === 'private' ? <Lock aria-label="Private group" className="size-3.5 shrink-0 text-muted" /> : null}
          </span>
          <span className="block truncate text-[13px] text-muted">{[members, group.description].filter(Boolean).join(' · ')}</span>
        </span>
      </Link>
    </li>
  )
}

type CourseResult = { id: string; slug: string; title: string; mentorName: string; accessType: 'free' | 'paid'; priceMinor: number; certificateEnabled?: boolean }

/** Course: cover tile, title, trainer · Free/Paid · Certificate. */
export function SearchCourseRow({ course, className = '' }: { course: CourseResult; className?: string }) {
  const meta = [course.mentorName, course.accessType === 'free' || course.priceMinor === 0 ? 'Free' : 'Paid', course.certificateEnabled ? 'Certificate' : null].filter(Boolean).join(' · ')
  return (
    <li className={`first:pt-0 ${className}`}>
      <Link href={`/learn/courses/${course.slug}`} className="flex min-h-14 items-center gap-3 py-3 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500">
        <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-navy-950 text-white">
          <BookOpen aria-hidden="true" className="size-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="line-clamp-2 text-[15px] font-semibold leading-5 text-navy-950">{course.title}</span>
          <span className="block truncate text-[13px] text-muted">{meta}</span>
        </span>
      </Link>
    </li>
  )
}

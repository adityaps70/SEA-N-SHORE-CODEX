import { MediaImage } from '@/components/ui/media-image'
import Link from 'next/link'
import { BadgeCheck, BookOpen, Building2 } from 'lucide-react'
import { ConnectionPrimaryAction } from '@/features/network/components/connection-primary-action'
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

/** Person: 48px photo, name, headline and the relationship's primary action (Connect, Accept, Pending or Message). */
export function SearchPersonRow({ profile, className = '' }: { profile: NetworkProfile; className?: string }) {
  const headline = profile.headline || [profile.rank, profile.currentCompany].filter(Boolean).join(' · ') || 'Maritime professional'
  const profileInitials = (
    <span className="grid size-12 place-items-center rounded-full bg-ocean-50 text-[15px] font-semibold text-ocean-800">{initials(profile.fullName)}</span>
  )
  return (
    <li className={`flex items-center gap-3 py-3 first:pt-0 ${className}`}>
      <Link href={`/people/${profile.slug}`} className="shrink-0 rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500" aria-label={`View ${profile.fullName} profile`}>
        {profile.avatarUrl ? (
          <MediaImage src={profile.avatarUrl} alt="" width={48} height={48} sizes="48px" className="size-12 rounded-full object-cover ring-1 ring-mist-100" fallback={profileInitials} />
        ) : profileInitials}
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={`/people/${profile.slug}`} className="block truncate text-[15px] font-semibold text-navy-950 hover:underline">
          {profile.fullName}
        </Link>
        <p className="truncate text-[13px] text-muted">{headline}</p>
      </div>
      <div className="shrink-0">
        <ConnectionPrimaryAction
          profileId={profile.id}
          initialRelationship={profile.relationship}
          variant="pill"
        />
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

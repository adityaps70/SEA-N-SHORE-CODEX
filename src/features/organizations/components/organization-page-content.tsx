import { MediaImage } from '@/components/ui/media-image'
import Image from 'next/image'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { ArrowRight, Award, BookOpen } from 'lucide-react'
import type { MarketplaceCourse } from '@/features/learning/marketplace-repository'
import { accessRoleLabel } from '../access-request-labels'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'SN'
}

/** White card with a heading row, used for each section on the organization page. */
export function PageSection({
  id,
  title,
  action,
  children,
  className = '',
}: {
  id: string
  title: string
  action?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <section aria-labelledby={id} className={`rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] sm:p-5 max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:shadow-none ${className}`}>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-lg font-bold text-navy-950 max-md:text-[17px]">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  )
}

export function SeeAllLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} scroll={false} className="inline-flex items-center gap-1 text-sm font-semibold text-ocean-700 hover:underline">
      {children} <ArrowRight aria-hidden="true" className="size-3.5" />
    </Link>
  )
}

export function EmptyState({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-mist-200 bg-mist-50/60 px-4 py-6 text-center text-sm leading-6 text-muted">
      <p>{children}</p>
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  )
}

export function LoadError({ what }: { what: string }) {
  return (
    <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
      {what} could not be loaded right now. Reload the page to try again.
    </p>
  )
}

function coursePrice(course: MarketplaceCourse) {
  if (course.accessType === 'free' || course.priceMinor === 0) return 'Free'
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: course.currency, maximumFractionDigits: 0 }).format(course.priceMinor / 100)
  } catch {
    return `${course.currency} ${Math.round(course.priceMinor / 100)}`
  }
}

/** Course published by the organization, in the Learn catalog card style. */
export function OrganizationCourseCard({ course }: { course: MarketplaceCourse }) {
  return (
    <article className="group flex h-full flex-col overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-teal-200">
      <div className="relative h-32 overflow-hidden bg-gradient-to-br from-navy-950 via-navy-900 to-teal-800">
        {course.thumbnailPath ? (
          <Image
            unoptimized
            fill
            sizes="(min-width: 1024px) 24rem, 100vw"
            src={`/api/learning-media/${course.thumbnailPath}`}
            alt={`${course.title} course cover`}
            className="object-cover"
          />
        ) : null}
        <div className="absolute inset-x-3 top-3 flex items-center justify-between gap-2">
          <span className="inline-flex min-w-0 items-center gap-1.5 truncate rounded-full border border-white/15 bg-navy-950/60 px-2.5 py-1 text-[11px] font-bold uppercase tracking-[0.12em] text-white">
            <BookOpen aria-hidden="true" className="size-3.5 shrink-0" /> {course.category}
          </span>
          <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-[11px] font-extrabold uppercase tracking-[0.1em] text-navy-950">{coursePrice(course)}</span>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-4">
        <Link href={`/learn/courses/${course.slug}`} className="line-clamp-2 text-base font-bold text-navy-950 group-hover:text-teal-800 hover:underline">
          {course.title}
        </Link>
        {course.subtitle ? <p className="mt-1 line-clamp-2 text-sm leading-6 text-muted">{course.subtitle}</p> : null}
        <div className="mt-3 flex flex-wrap gap-1.5 text-xs font-bold text-muted">
          <span className="rounded-full bg-mist-50 px-2.5 py-1">{course.language}</span>
          {course.certificateEnabled ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-teal-800"><Award aria-hidden="true" className="size-3.5" /> Certificate</span>
          ) : null}
        </div>
        <div className="mt-auto pt-4">
          <Link
            href={`/learn/courses/${course.slug}`}
            aria-label={`View course: ${course.title}`}
            className="inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white transition hover:bg-navy-900"
          >
            View course <ArrowRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </div>
    </article>
  )
}

export type OrganizationPersonView = {
  id: string
  fullName: string
  slug: string | null
  headline: string | null
  avatarUrl: string | null
  memberRole: Parameters<typeof accessRoleLabel>[0] | null
}

/** People connected to the organization, with public profile details only. */
export function OrganizationPeopleList({ people }: { people: OrganizationPersonView[] }) {
  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {people.map((person) => {
        const personInitials = (
          <span aria-hidden="true" className="grid size-12 shrink-0 place-items-center rounded-full bg-mist-100 text-sm font-semibold text-navy-950">{initials(person.fullName)}</span>
        )
        const photo = person.avatarUrl ? (
          <MediaImage avatar src={person.avatarUrl} alt="" width={48} height={48} sizes="48px" className="size-12 shrink-0 rounded-full object-cover ring-1 ring-mist-100" fallback={personInitials} />
        ) : personInitials
        return (
          <li key={person.id} className="flex min-w-0 items-center gap-3 rounded-xl border border-mist-100 p-3">
            {photo}
            <div className="min-w-0 flex-1">
              {person.slug ? (
                <Link href={`/people/${person.slug}`} className="block truncate font-semibold text-navy-950 hover:text-ocean-700 hover:underline">{person.fullName}</Link>
              ) : (
                <p className="truncate font-semibold text-navy-950">{person.fullName}</p>
              )}
              <p className="line-clamp-2 text-sm leading-5 text-muted">{person.headline || 'Maritime professional'}</p>
              {person.memberRole ? (
                <p className="mt-1 text-xs font-semibold text-teal-800">
                  {person.memberRole === 'owner' || person.memberRole === 'administrator'
                    ? `Team · ${accessRoleLabel(person.memberRole)}`
                    : 'Team member'}
                </p>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

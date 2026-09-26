import Link from 'next/link'
import { BadgeCheck, BookOpen, BriefcaseBusiness, Building2, CalendarDays, Search, UsersRound } from 'lucide-react'
import { PremiumPageHero } from '@/components/product/premium-page-hero'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { EventCard } from '@/features/events/components/event-card'
import { JobCard } from '@/features/jobs/components/job-card'
import { getJobsDiscovery } from '@/features/jobs/queries'
import { marketplaceRepository } from '@/features/learning/marketplace-repository'
import { getNetworkHub } from '@/features/network/queries'
import { organizationRepository } from '@/features/organizations/repository'
import { NetworkProfileCard } from '@/features/network/components/network-profile-card'

const verticalPaths = {
  people: '/network',
  jobs: '/jobs',
  courses: '/learn',
  events: '/events',
  organizations: '/organizations',
} as const

function verticalHref(path: typeof verticalPaths.people | typeof verticalPaths.jobs | typeof verticalPaths.events, query: string) {
  const params = new URLSearchParams()
  params.set('q', query)
  if (path === '/network') params.set('tab', 'discover')
  return `${path}?${params.toString()}`
}

function learnHref(query: string) {
  const params = new URLSearchParams()
  params.set('search', query)
  return `${verticalPaths.courses}?${params.toString()}`
}

function SectionHeading({
  icon: Icon,
  title,
  count,
  href,
}: {
  icon: typeof UsersRound
  title: string
  count: number
  href: string
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-teal-50 text-teal-800">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h2 className="text-xl font-bold text-navy-950">{title}</h2>
          <p className="text-sm text-muted">{count} result{count === 1 ? '' : 's'}</p>
        </div>
      </div>
      <Link href={href} className="text-sm font-bold text-teal-800 transition hover:text-teal-700">
        See all {title.toLowerCase()} →
      </Link>
    </div>
  )
}

function EmptyVertical({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-mist-200 bg-white px-5 py-8 text-center text-sm text-muted">
      No matching {label.toLowerCase()} found.
    </div>
  )
}

export default async function GlobalSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>
}) {
  const params = await searchParams
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q
  const query = rawQuery?.trim().slice(0, 100) ?? ''

  if (!query) {
    return (
      <section className="py-2 sm:py-5">
        <PremiumPageHero
          eyebrow="Global search"
          title="Search the maritime ecosystem."
          description="Find professionals, organizations, jobs, courses and events across Sea N Shore from one place."
        >
          <form action="/search" method="get" role="search" className="relative mt-6 max-w-3xl rounded-2xl bg-white p-2">
            <label htmlFor="global-search-page" className="sr-only">Search Sea N Shore</label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-6 top-1/2 size-5 -translate-y-1/2 text-muted" />
            <input id="global-search-page" name="q" type="search" maxLength={100} autoFocus placeholder="Search people, organizations, jobs, courses or events" className="min-h-12 w-full rounded-xl bg-mist-50 py-3 pl-12 pr-4 text-sm text-ink outline-none placeholder:text-muted focus:bg-white focus:ring-1 focus:ring-teal-200" />
          </form>
        </PremiumPageHero>
        <div className="mt-5 rounded-[1.5rem] border border-dashed border-mist-200 bg-white px-6 py-12 text-center">
          <Search aria-hidden="true" className="mx-auto size-7 text-muted" />
          <p className="mt-3 font-semibold text-navy-950">Start with a name, rank, role, skill, course or event topic.</p>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">Your search stays with you as you continue into People, Jobs, Courses or Events.</p>
        </div>
      </section>
    )
  }

  const user = await requireAwsUser()
  const [network, organizations, jobs, courses, events] = await Promise.all([
    getNetworkHub('discover', query),
    organizationRepository.searchCompanies(query),
    getJobsDiscovery({ q: query }),
    marketplaceRepository.listPublishedCourses({ search: query }),
    calendarEventRepository.listDiscoverEvents(user.id, { search: query }),
  ])

  const peopleResults = network.profiles.slice(0, 6)
  const organizationResults = organizations.slice(0, 6)
  const jobResults = jobs.items.slice(0, 6)
  const courseResults = courses.slice(0, 6)
  const eventResults = events.slice(0, 6)
  const totalResults = network.profiles.length + organizations.length + jobs.items.length + courses.length + events.length

  return (
    <section className="py-2 sm:py-5">
      <PremiumPageHero
        eyebrow="Global search"
        title={`Results for “${query}”`}
        description={`${totalResults} matching result${totalResults === 1 ? '' : 's'} across people, organizations, jobs, courses and events.`}
      >
        <form action="/search" method="get" role="search" className="relative mt-6 max-w-3xl rounded-2xl bg-white p-2">
          <label htmlFor="global-search-page" className="sr-only">Search Sea N Shore</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-6 top-1/2 size-5 -translate-y-1/2 text-muted" />
          <input id="global-search-page" name="q" type="search" defaultValue={query} maxLength={100} placeholder="Search people, organizations, jobs, courses or events" className="min-h-12 w-full rounded-xl bg-mist-50 py-3 pl-12 pr-4 text-sm text-ink outline-none placeholder:text-muted focus:bg-white focus:ring-1 focus:ring-teal-200" />
        </form>
      </PremiumPageHero>

      <div className="mt-6 space-y-8">
        <section aria-labelledby="global-people-heading">
          <div id="global-people-heading">
            <SectionHeading icon={UsersRound} title="People" count={network.profiles.length} href={verticalHref(verticalPaths.people, query)} />
          </div>
          {peopleResults.length ? <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">{peopleResults.map((profile) => <NetworkProfileCard key={profile.id} profile={profile} />)}</div> : <EmptyVertical label="People" />}
        </section>

        <section aria-labelledby="global-organizations-heading" className="border-t border-mist-100 pt-7">
          <div id="global-organizations-heading">
            <SectionHeading icon={Building2} title="Organizations" count={organizations.length} href={verticalPaths.organizations} />
          </div>
          {organizationResults.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {organizationResults.map((organization) => (
                <Link
                  key={organization.id}
                  href={'/organizations/' + organization.slug}
                  className="group rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-teal-200"
                >
                  <div className="flex items-start gap-3">
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
                      <Building2 aria-hidden="true" className="size-5" />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="font-bold text-navy-950 transition group-hover:text-teal-800">{organization.name}</h3>
                        {organization.verified ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-bold text-emerald-800">
                            <BadgeCheck aria-hidden="true" className="size-3" /> Verified
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 text-sm text-muted">{organization.companyType ?? 'Maritime organization'}</p>
                      {organization.website ? <p className="mt-2 truncate text-xs font-semibold text-ocean-700">{organization.website}</p> : null}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          ) : <EmptyVertical label="Organizations" />}
        </section>

        <section aria-labelledby="global-jobs-heading" className="border-t border-mist-100 pt-7">
          <div id="global-jobs-heading">
            <SectionHeading icon={BriefcaseBusiness} title="Jobs" count={jobs.items.length} href={verticalHref(verticalPaths.jobs, query)} />
          </div>
          {jobResults.length ? <div className="grid gap-4 xl:grid-cols-2">{jobResults.map(({ job, match, isSaved }) => <JobCard key={job.id} job={job} match={match} isSaved={isSaved} />)}</div> : <EmptyVertical label="Jobs" />}
        </section>

        <section aria-labelledby="global-courses-heading" className="border-t border-mist-100 pt-7">
          <div id="global-courses-heading">
            <SectionHeading icon={BookOpen} title="Courses" count={courses.length} href={learnHref(query)} />
          </div>
          {courseResults.length ? (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {courseResults.map((course) => (
                <Link key={course.id} href={`/learn/courses/${course.slug}`} className="group rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-teal-200">
                  <div className="flex items-center justify-between gap-3 text-xs font-bold text-muted"><span className="rounded-full bg-mist-50 px-2.5 py-1">{course.category}</span><span>{course.accessType === 'free' || course.priceMinor === 0 ? 'Free' : 'Paid'}</span></div>
                  <h3 className="mt-4 text-lg font-bold text-navy-950 transition group-hover:text-teal-800">{course.title}</h3>
                  {course.subtitle ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{course.subtitle}</p> : null}
                  <p className="mt-4 text-xs font-semibold text-teal-800">By {course.mentorName}</p>
                </Link>
              ))}
            </div>
          ) : <EmptyVertical label="Courses" />}
        </section>

        <section aria-labelledby="global-events-heading" className="border-t border-mist-100 pt-7">
          <div id="global-events-heading">
            <SectionHeading icon={CalendarDays} title="Events" count={events.length} href={verticalHref(verticalPaths.events, query)} />
          </div>
          {eventResults.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{eventResults.map((event) => <EventCard key={event.id} event={event} />)}</div> : <EmptyVertical label="Events" />}
        </section>
      </div>
    </section>
  )
}

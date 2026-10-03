import type { Metadata } from 'next'
import Link from 'next/link'
import { BadgeCheck, BookOpen, BriefcaseBusiness, Building2, CalendarDays, Hash, Search, UsersRound } from 'lucide-react'
import { PremiumPageHero } from '@/components/product/premium-page-hero'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { GroupCard } from '@/features/community/components/group-card'
import { communityRepository } from '@/features/community/repository'
import type { CommunityGroup } from '@/features/community/types'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { EventCard } from '@/features/events/components/event-card'
import { JobCard } from '@/features/jobs/components/job-card'
import { JobListRow } from '@/features/jobs/components/job-list-row'
import { getJobsDiscovery } from '@/features/jobs/queries'
import { hashtagHref } from '@/features/hashtags/parse'
import { hashtagRepository, type HashtagSuggestion } from '@/features/hashtags/repository'
import { marketplaceRepository } from '@/features/learning/marketplace-repository'
import { getNetworkHub } from '@/features/network/queries'
import { organizationRepository } from '@/features/organizations/repository'
import { NetworkProfileCard } from '@/features/network/components/network-profile-card'
import {
  PHONE_ALL_RESULTS_PER_VERTICAL,
  PHONE_CHIP_RESULTS,
  SEARCH_CHIP_LABELS,
  hashtagSearchQuery,
  parseSearchChip,
  resultCountLabel,
  resultItemClass,
  resultLimit,
  searchChipHref,
  sectionPhoneClass,
  type SearchChip,
  type SearchVertical,
} from './search-filters'
import { PHONE_RESULT_LIST_CLASS, SearchCourseRow, SearchGroupRow, SearchHashtagRow, SearchOrganizationRow, SearchPersonRow, hashtagPostCountLabel } from './search-result-rows'
import { SearchPhoneBar } from './search-phone-bar'

export const metadata: Metadata = { title: 'Search' }

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

function organizationHref(query: string) {
  const params = new URLSearchParams()
  params.set('q', query)
  return verticalPaths.organizations + '?' + params.toString()
}

/** Community directory (round 9B) with the same search. */
function groupsHref(query: string) {
  const params = new URLSearchParams()
  params.set('q', query)
  return '/community?' + params.toString()
}
function SectionHeading({
  icon: Icon,
  title,
  count,
  href,
  chip,
}: {
  icon: typeof UsersRound
  title: string
  count: number
  href: string
  chip: SearchChip
}) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3 max-md:mb-3">
      <div className="flex items-center gap-3">
        <span className="grid size-10 place-items-center rounded-xl bg-teal-50 text-teal-800 max-md:hidden">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div>
          <h2 className="text-xl font-bold text-navy-950 max-md:text-[17px]">{title}</h2>
          <p className="text-sm text-muted max-md:hidden">{count} result{count === 1 ? '' : 's'}</p>
        </div>
      </div>
      {/* Phones under All use the "See all … results" row below the section instead. */}
      <Link href={href} className={`text-sm font-bold text-teal-800 transition hover:text-teal-700 max-md:inline-flex max-md:min-h-11 max-md:items-center ${chip === 'all' ? 'max-md:hidden' : ''}`}>
        See all {title.toLowerCase()} →
      </Link>
    </div>
  )
}

/** Phones, All chip: a "See all … results" row that switches to that vertical's chip. */
function PhoneSeeAll({ chip, vertical, count, query }: { chip: SearchChip; vertical: SearchVertical; count: number; query: string }) {
  if (chip !== 'all' || count <= PHONE_ALL_RESULTS_PER_VERTICAL) return null
  return (
    <Link
      href={searchChipHref(query, vertical)}
      className="-mx-4 -mb-4 mt-3 flex min-h-12 items-center justify-center border-t border-mist-100 text-[15px] font-semibold text-navy-700 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500 md:hidden"
    >
      See all {SEARCH_CHIP_LABELS[vertical].toLowerCase()} results
    </Link>
  )
}

function SearchChips({ query, chip }: { query: string; chip: SearchChip }) {
  const chips: SearchChip[] = ['all', 'people', 'jobs', 'organizations', 'groups', 'courses', 'events', 'hashtags']
  return (
    <nav aria-label="Search filters" className="-mx-4 flex gap-2 overflow-x-auto border-b border-mist-100 bg-white px-4 py-3 md:hidden">
      {chips.map((value) => (
        <Link
          key={value}
          href={searchChipHref(query, value)}
          aria-current={chip === value ? 'page' : undefined}
          className="inline-flex min-h-8 shrink-0 items-center rounded-full border border-mist-300 bg-white px-3.5 text-sm font-semibold text-navy-700 hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 aria-[current=page]:border-navy-950 aria-[current=page]:bg-navy-950 aria-[current=page]:text-white"
        >
          {SEARCH_CHIP_LABELS[value]}
        </Link>
      ))}
    </nav>
  )
}

/** Phones: sections run edge to edge as white blocks separated by the page background. */
const PHONE_SECTION = 'max-md:-mx-4 max-md:border-t-0 max-md:bg-white max-md:p-4'

function EmptyVertical({ label, failed = false }: { label: string; failed?: boolean }) {
  if (failed) {
    return (
      <div role="alert" className="rounded-2xl border border-amber-200 bg-amber-50 px-5 py-6 text-center text-sm text-amber-900">
        {label} results could not be loaded just now. Search again in a moment, or open {label} directly.
      </div>
    )
  }
  return (
    <div className="rounded-2xl border border-dashed border-mist-200 bg-white px-5 py-8 text-center text-sm text-muted">
      No matching {label.toLowerCase()} found.
    </div>
  )
}

function settledValue<T>(result: PromiseSettledResult<T[]>, fallback: T[]): T[] {
  return result.status === 'fulfilled' ? result.value : fallback
}

export default async function GlobalSearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; type?: string | string[] }>
}) {
  const params = await searchParams
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q
  const query = rawQuery?.trim().slice(0, 100) ?? ''
  const chip = parseSearchChip(params.type)

  if (!query) {
    return (
      <section className="py-2 max-md:py-0 sm:py-5">
        <SearchPhoneBar query="" chip={chip} />
        {/* Phones: no page intro; the page bar holds the search input. */}
        <div className="max-md:hidden">
        <PremiumPageHero
          eyebrow="Global search"
          title="Search the maritime ecosystem."
          description="Find professionals, organizations, jobs, courses and events across Sea N Shore from one place."
        >
          <form action="/search" method="get" role="search" className="relative mt-4 max-w-3xl rounded-2xl bg-white p-2">
            <label htmlFor="global-search-page" className="sr-only">Search Sea N Shore</label>
            <Search aria-hidden="true" className="pointer-events-none absolute left-6 top-1/2 size-5 -translate-y-1/2 text-muted" />
            <input id="global-search-page" name="q" type="search" maxLength={100} autoFocus placeholder="Search people, organizations, groups, jobs, courses or events" className="min-h-12 w-full rounded-xl bg-mist-50 py-3 pl-12 pr-4 text-sm text-ink outline-none placeholder:text-muted focus:bg-white focus:ring-1 focus:ring-teal-200" />
          </form>
        </PremiumPageHero>
        </div>
        <div className="mt-5 rounded-[1.5rem] border border-dashed border-mist-200 bg-white px-6 py-12 text-center max-md:mt-4">
          <Search aria-hidden="true" className="mx-auto size-7 text-muted" />
          <p className="mt-3 font-semibold text-navy-950">Start with a name, rank, role, skill, course or event topic.</p>
          <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-muted">Your search stays with you as you continue into People, Organizations, Groups, Jobs, Courses or Events.</p>
        </div>
      </section>
    )
  }

  const user = await requireAwsUser()
  // Hashtags (round 9B) load beside the other verticals; a failure only empties their section.
  const hashtagSearch: Promise<{ items: HashtagSuggestion[]; failed: boolean }> = hashtagRepository
    .searchHashtags(hashtagSearchQuery(query), PHONE_CHIP_RESULTS)
    .then((items) => ({ items, failed: false }))
    .catch(() => ({ items: [], failed: true }))
  // Community groups (round 9B) load the same way: name/description matches, live groups only.
  const groupSearch: Promise<{ items: CommunityGroup[]; failed: boolean }> = communityRepository
    .searchGroups(user.id, query, PHONE_CHIP_RESULTS)
    .then((items) => ({ items, failed: false }))
    .catch(() => ({ items: [], failed: true }))
  // Each vertical loads independently: one failing source shows a notice in its
  // section instead of taking down the whole results page.
  const settled = await Promise.allSettled([
    getNetworkHub('discover', query),
    organizationRepository.searchCompanies(query),
    getJobsDiscovery({ q: query }),
    marketplaceRepository.listPublishedCourses({ search: query }),
    calendarEventRepository.listDiscoverEvents(user.id, { search: query }),
  ] as const)
  const hashtagResult = await hashtagSearch
  const groupResult = await groupSearch
  const failed = {
    hashtags: hashtagResult.failed,
    groups: groupResult.failed,
    people: settled[0].status === 'rejected',
    organizations: settled[1].status === 'rejected',
    jobs: settled[2].status === 'rejected',
    courses: settled[3].status === 'rejected',
    events: settled[4].status === 'rejected',
  }
  if (Object.values(failed).some(Boolean)) {
    console.error('[global_search_partial_failure]', failed)
  }
  const network = { profiles: settled[0].status === 'fulfilled' ? settled[0].value.profiles : [] }
  const organizations = settledValue(settled[1], [])
  const jobs = { items: settled[2].status === 'fulfilled' ? settled[2].value.items : [] }
  const courses = settledValue(settled[3], [])
  const events = settledValue(settled[4], [])

  const peopleResults = network.profiles.slice(0, resultLimit(chip, 'people'))
  const organizationResults = organizations.slice(0, resultLimit(chip, 'organizations'))
  const jobResults = jobs.items.slice(0, resultLimit(chip, 'jobs'))
  const courseResults = courses.slice(0, resultLimit(chip, 'courses'))
  const eventResults = events.slice(0, resultLimit(chip, 'events'))
  const hashtags = hashtagResult.items
  const hashtagResults = hashtags.slice(0, resultLimit(chip, 'hashtags'))
  const groups = groupResult.items
  const groupResults = groups.slice(0, resultLimit(chip, 'groups'))
  const totalResults = network.profiles.length + organizations.length + jobs.items.length + courses.length + events.length + hashtags.length + groups.length
  const verticalCounts: Record<SearchVertical, number> = {
    people: network.profiles.length,
    organizations: organizations.length,
    groups: groups.length,
    jobs: jobs.items.length,
    courses: courses.length,
    events: events.length,
    hashtags: hashtags.length,
  }
  const phoneCount = chip === 'all' ? totalResults : verticalCounts[chip]

  return (
    <section className="py-2 max-md:py-0 sm:py-5">
      <SearchPhoneBar query={query} chip={chip} />
      <SearchChips query={query} chip={chip} />
      <p data-testid="search-result-count" className="py-2.5 text-[13px] text-muted md:hidden">
        {resultCountLabel(phoneCount, query)}
      </p>
      {/* Phones: no page intro; the count above replaces the hero description. */}
      <div className="max-md:hidden">
      <PremiumPageHero
        eyebrow="Global search"
        title={`Results for “${query}”`}
        description={`${totalResults} matching result${totalResults === 1 ? '' : 's'} across people, organizations, groups, jobs, courses and events.`}
      >
        <form action="/search" method="get" role="search" className="relative mt-4 max-w-3xl rounded-2xl bg-white p-2">
          <label htmlFor="global-search-page" className="sr-only">Search Sea N Shore</label>
          <Search aria-hidden="true" className="pointer-events-none absolute left-6 top-1/2 size-5 -translate-y-1/2 text-muted" />
          <input id="global-search-page" name="q" type="search" defaultValue={query} maxLength={100} placeholder="Search people, organizations, groups, jobs, courses or events" className="min-h-12 w-full rounded-xl bg-mist-50 py-3 pl-12 pr-4 text-sm text-ink outline-none placeholder:text-muted focus:bg-white focus:ring-1 focus:ring-teal-200" />
        </form>
      </PremiumPageHero>
      </div>

      <div className="mt-6 space-y-8 max-md:mt-0 max-md:space-y-2">
        <section aria-labelledby="global-people-heading" className={`${PHONE_SECTION} ${sectionPhoneClass(chip, 'people')}`}>
          <div id="global-people-heading">
            <SectionHeading icon={UsersRound} title="People" count={network.profiles.length} href={verticalHref(verticalPaths.people, query)} chip={chip} />
          </div>
          {peopleResults.length ? (
            <>
              <div className="grid gap-4 max-md:hidden sm:grid-cols-2 xl:grid-cols-3">{peopleResults.map((profile, index) => <div key={profile.id} className={resultItemClass(chip, index)}><NetworkProfileCard profile={profile} actions="full" /></div>)}</div>
              {/* Phones: compact rows with one Connect / Message pill instead of the suggestion cards. */}
              <ul aria-label="People results" className={PHONE_RESULT_LIST_CLASS}>{peopleResults.map((profile, index) => <SearchPersonRow key={profile.id} profile={profile} className={resultItemClass(chip, index)} />)}</ul>
            </>
          ) : <EmptyVertical label="People" failed={failed.people} />}
          <PhoneSeeAll chip={chip} vertical="people" count={network.profiles.length} query={query} />
        </section>

        <section aria-labelledby="global-organizations-heading" className={`border-t border-mist-100 pt-7 ${PHONE_SECTION} ${sectionPhoneClass(chip, 'organizations')}`}>
          <div id="global-organizations-heading">
            <SectionHeading icon={Building2} title="Organizations" count={organizations.length} href={organizationHref(query)} chip={chip} />
          </div>
          {organizationResults.length ? (
            <>
            <div className="grid gap-4 max-md:hidden sm:grid-cols-2 xl:grid-cols-3">
              {organizationResults.map((organization, index) => (
                <Link
                  key={organization.id}
                  href={'/organizations/' + organization.slug}
                  className={`group rounded-[1.4rem] border border-mist-200 bg-white p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-teal-200 max-md:rounded-2xl max-md:p-4 max-md:shadow-none ${resultItemClass(chip, index) ?? ''}`}
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
            <ul aria-label="Organization results" className={PHONE_RESULT_LIST_CLASS}>{organizationResults.map((organization, index) => <SearchOrganizationRow key={organization.id} organization={organization} className={resultItemClass(chip, index)} />)}</ul>
            </>
          ) : <EmptyVertical label="Organizations" failed={failed.organizations} />}
          <PhoneSeeAll chip={chip} vertical="organizations" count={organizations.length} query={query} />
        </section>

        <section aria-labelledby="global-groups-heading" className={`border-t border-mist-100 pt-7 ${PHONE_SECTION} ${sectionPhoneClass(chip, 'groups')}`}>
          <div id="global-groups-heading">
            <SectionHeading icon={UsersRound} title="Groups" count={groups.length} href={groupsHref(query)} chip={chip} />
          </div>
          {groupResults.length ? (
            <>
              <div className="grid gap-4 max-md:hidden sm:grid-cols-2 xl:grid-cols-3">
                {groupResults.map((group, index) => <div key={group.id} className={resultItemClass(chip, index)}><GroupCard group={group} /></div>)}
              </div>
              <ul aria-label="Group results" className={PHONE_RESULT_LIST_CLASS}>{groupResults.map((group, index) => <SearchGroupRow key={group.id} group={group} className={resultItemClass(chip, index)} />)}</ul>
            </>
          ) : <EmptyVertical label="Groups" failed={failed.groups} />}
          <PhoneSeeAll chip={chip} vertical="groups" count={groups.length} query={query} />
        </section>

        <section aria-labelledby="global-jobs-heading" className={`border-t border-mist-100 pt-7 ${PHONE_SECTION} ${sectionPhoneClass(chip, 'jobs')}`}>
          <div id="global-jobs-heading">
            <SectionHeading icon={BriefcaseBusiness} title="Jobs" count={jobs.items.length} href={verticalHref(verticalPaths.jobs, query)} chip={chip} />
          </div>
          {jobResults.length ? (
            <>
              <div className="grid gap-4 max-md:hidden xl:grid-cols-2">{jobResults.map(({ job, match, isSaved }, index) => <div key={job.id} className={resultItemClass(chip, index)}><JobCard job={job} match={match} isSaved={isSaved} /></div>)}</div>
              <ul aria-label="Job results" className={`-mx-4 ${PHONE_RESULT_LIST_CLASS}`}>{jobResults.map(({ job, match, isSaved }, index) => <JobListRow key={job.id} job={job} match={match} isSaved={isSaved} className={resultItemClass(chip, index)} />)}</ul>
            </>
          ) : <EmptyVertical label="Jobs" failed={failed.jobs} />}
          <PhoneSeeAll chip={chip} vertical="jobs" count={jobs.items.length} query={query} />
        </section>

        <section aria-labelledby="global-courses-heading" className={`border-t border-mist-100 pt-7 ${PHONE_SECTION} ${sectionPhoneClass(chip, 'courses')}`}>
          <div id="global-courses-heading">
            <SectionHeading icon={BookOpen} title="Courses" count={courses.length} href={learnHref(query)} chip={chip} />
          </div>
          {courseResults.length ? (
            <>
            <div className="grid gap-4 max-md:hidden md:grid-cols-2 xl:grid-cols-3">
              {courseResults.map((course, index) => (
                <Link key={course.id} href={`/learn/courses/${course.slug}`} className={`group rounded-[1.4rem] border border-mist-200 bg-white p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-teal-200 max-md:rounded-2xl max-md:p-4 max-md:shadow-none ${resultItemClass(chip, index) ?? ''}`}>
                  <div className="flex items-center justify-between gap-3 text-xs font-bold text-muted"><span className="rounded-full bg-mist-50 px-2.5 py-1">{course.category}</span><span>{course.accessType === 'free' || course.priceMinor === 0 ? 'Free' : 'Paid'}</span></div>
                  <h3 className="mt-4 text-lg font-bold text-navy-950 transition group-hover:text-teal-800">{course.title}</h3>
                  {course.subtitle ? <p className="mt-2 line-clamp-2 text-sm leading-6 text-muted">{course.subtitle}</p> : null}
                  <p className="mt-4 text-xs font-semibold text-teal-800">By {course.mentorName}</p>
                </Link>
              ))}
            </div>
            <ul aria-label="Course results" className={PHONE_RESULT_LIST_CLASS}>{courseResults.map((course, index) => <SearchCourseRow key={course.id} course={course} className={resultItemClass(chip, index)} />)}</ul>
            </>
          ) : <EmptyVertical label="Courses" failed={failed.courses} />}
          <PhoneSeeAll chip={chip} vertical="courses" count={courses.length} query={query} />
        </section>

        <section aria-labelledby="global-events-heading" className={`border-t border-mist-100 pt-7 ${PHONE_SECTION} ${sectionPhoneClass(chip, 'events')}`}>
          <div id="global-events-heading">
            <SectionHeading icon={CalendarDays} title="Events" count={events.length} href={verticalHref(verticalPaths.events, query)} chip={chip} />
          </div>
          {eventResults.length ? <div className="grid gap-5 max-md:gap-2 md:grid-cols-2 xl:grid-cols-3">{eventResults.map((event, index) => <div key={event.id} className={resultItemClass(chip, index)}><EventCard event={event} /></div>)}</div> : <EmptyVertical label="Events" failed={failed.events} />}
          <PhoneSeeAll chip={chip} vertical="events" count={events.length} query={query} />
        </section>

        <section aria-labelledby="global-hashtags-heading" className={`border-t border-mist-100 pt-7 ${PHONE_SECTION} ${sectionPhoneClass(chip, 'hashtags')}`}>
          <div id="global-hashtags-heading">
            <SectionHeading icon={Hash} title="Hashtags" count={hashtags.length} href={searchChipHref(query, 'hashtags')} chip={chip} />
          </div>
          {hashtagResults.length ? (
            <>
              <div className="grid gap-4 max-md:hidden sm:grid-cols-2 xl:grid-cols-3">
                {hashtagResults.map((hashtag, index) => (
                  <Link
                    key={hashtag.tag}
                    href={hashtagHref(hashtag.tag)}
                    className={`group flex items-center gap-3 rounded-[1.4rem] border border-mist-200 bg-white p-5 shadow-[var(--shadow-card)] transition hover:-translate-y-0.5 hover:border-teal-200 ${resultItemClass(chip, index) ?? ''}`}
                  >
                    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
                      <Hash aria-hidden="true" className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate font-bold text-navy-950 transition group-hover:text-teal-800">#{hashtag.tag}</span>
                      <span className="mt-1 block text-sm text-muted">{hashtagPostCountLabel(hashtag.postCount)}</span>
                    </span>
                  </Link>
                ))}
              </div>
              <ul aria-label="Hashtag results" className={PHONE_RESULT_LIST_CLASS}>{hashtagResults.map((hashtag, index) => <SearchHashtagRow key={hashtag.tag} hashtag={hashtag} className={resultItemClass(chip, index)} />)}</ul>
            </>
          ) : <EmptyVertical label="Hashtags" failed={failed.hashtags} />}
          <PhoneSeeAll chip={chip} vertical="hashtags" count={hashtags.length} query={query} />
        </section>
      </div>
    </section>
  )
}

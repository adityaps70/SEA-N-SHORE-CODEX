import type { Metadata } from 'next'
import Link from 'next/link'
import { ChevronDown, Search } from 'lucide-react'
import { PremiumPageHero } from '@/components/product/premium-page-hero'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import {
  CALENDAR_EVENT_CATEGORIES,
  CALENDAR_EVENT_FORMATS,
  CALENDAR_EVENT_TYPES,
  type CalendarEventCategory,
  type CalendarEventFormat,
  type CalendarEventType,
} from '@/features/events/calendar-types'
import { EventCard } from '@/features/events/components/event-card'
import { EventNav } from '@/features/events/components/event-nav'
import { EventsPhoneSearch } from '@/features/events/components/events-phone-search'
import { PastEventsToggle } from '@/features/events/components/past-events-toggle'
import { eventFormatLabel } from '@/features/events/event-labels'

export const metadata: Metadata = { title: 'Events' }

function titleCase(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }
function categoryValue(value?: string): CalendarEventCategory | undefined { return CALENDAR_EVENT_CATEGORIES.find((item) => item === value) }
function typeValue(value?: string): CalendarEventType | undefined { return CALENDAR_EVENT_TYPES.find((item) => item === value) }
function formatValue(value?: string): CalendarEventFormat | undefined { return CALENDAR_EVENT_FORMATS.find((item) => item === value) }

const filterSelectClass = 'min-h-12 w-full cursor-pointer appearance-none rounded-2xl border border-mist-100 bg-mist-50 px-4 pr-10 text-sm font-semibold text-navy-900 outline-none transition hover:border-mist-200 focus:border-teal-500'

function FilterChevron() {
  return <ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3.5 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
}

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; eventType?: string; format?: string; location?: string }> }) {
  const user = await requireAwsUser()
  const params = await searchParams
  const typedSearch = params.q?.trim() ?? ''
  const legacyLocation = params.location?.trim() ?? ''
  // Older links used a separate ?location= box. Treat it as the search text; if a link carries both,
  // keep the place as an extra filter so the results match what the link used to show.
  const searchText = typedSearch || legacyLocation
  const placeFilter = typedSearch ? legacyLocation : ''
  const filters = {
    search: searchText,
    category: categoryValue(params.category),
    eventType: typeValue(params.eventType),
    format: formatValue(params.format),
    location: placeFilter,
  }
  const hasFilters = Boolean(filters.search || filters.category || filters.eventType || filters.format || filters.location)
  const withoutPlaceHref = (() => {
    const next = new URLSearchParams()
    if (typedSearch) next.set('q', typedSearch)
    if (filters.category) next.set('category', filters.category)
    if (filters.eventType) next.set('eventType', filters.eventType)
    if (filters.format) next.set('format', filters.format)
    const query = next.toString()
    return query ? `/events?${query}` : '/events'
  })()
  const [upcoming, archive] = await Promise.all([
    calendarEventRepository.listDiscoverEvents(user.id, filters),
    calendarEventRepository.listPastEvents(user.id, filters),
  ])

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 py-2 sm:px-6 sm:py-6 lg:px-8 max-md:space-y-3 max-md:py-0">
      {/* Phones: chips + Create and one search box with a Filters sheet replace the hero and the filter form. */}
      <EventNav active="discover" className="max-md:-mt-4 md:hidden" />
      <EventsPhoneSearch
        search={searchText}
        category={filters.category}
        eventType={filters.eventType}
        format={filters.format}
        categories={CALENDAR_EVENT_CATEGORIES.map((value) => ({ value, label: titleCase(value) }))}
        eventTypes={CALENDAR_EVENT_TYPES.map((value) => ({ value, label: titleCase(value) }))}
        formats={CALENDAR_EVENT_FORMATS.map((value) => ({ value, label: eventFormatLabel(value) }))}
      />
      {placeFilter ? (
        <p className="text-[13px] text-muted md:hidden">
          Only events in or near “{placeFilter}”. <Link href={withoutPlaceHref} className="font-semibold text-ocean-700 hover:underline">Remove place filter</Link>
        </p>
      ) : null}
      <div className="max-md:hidden">
      <PremiumPageHero
        eyebrow="Maritime events"
        title="Learn, meet and move the maritime industry forward."
        description="Discover webinars, masterclasses, conferences, meetups and professional sessions hosted by verified members and maritime organizations."
      >
        <div className="mt-4 flex flex-wrap gap-2">
          <Link href="/events" aria-current="page" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-navy-950 transition-colors hover:bg-mist-100">Discover</Link>
          <Link href="/events/my" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">My Events</Link>
          <Link href="/events/hosting" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">Hosting</Link>
          <Link href="/events/create" className="ml-auto rounded-xl bg-teal-400 px-4 py-2 text-sm font-bold text-navy-950 hover:bg-teal-300">Create event</Link>
        </div>
      </PremiumPageHero>
      </div>

      <form method="get" role="search" aria-label="Find events" className="max-md:hidden grid gap-3 rounded-[1.5rem] border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] sm:p-5 lg:grid-cols-3 xl:grid-cols-[2.4fr_repeat(3,1fr)_auto]">
        <label className="relative lg:col-span-3 xl:col-span-1">
          <span className="sr-only">Search events</span>
          <Search aria-hidden="true" className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <input type="search" name="q" defaultValue={searchText} placeholder="Search title, topic, host or place" className="min-h-12 w-full rounded-2xl border border-mist-100 bg-mist-50 pl-11 pr-4 text-sm font-normal text-navy-950 outline-none transition placeholder:text-slate-400 focus:border-teal-500" />
        </label>
        <label className="relative"><span className="sr-only">Category</span><select name="category" defaultValue={params.category ?? ''} className={filterSelectClass}><option value="">All categories</option>{CALENDAR_EVENT_CATEGORIES.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select><FilterChevron /></label>
        <label className="relative"><span className="sr-only">Event type</span><select name="eventType" defaultValue={params.eventType ?? ''} className={filterSelectClass}><option value="">All types</option>{CALENDAR_EVENT_TYPES.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select><FilterChevron /></label>
        <label className="relative"><span className="sr-only">Format</span><select name="format" defaultValue={params.format ?? ''} className={filterSelectClass}><option value="">Any format</option>{CALENDAR_EVENT_FORMATS.map((value) => <option key={value} value={value}>{eventFormatLabel(value)}</option>)}</select><FilterChevron /></label>
        <button type="submit" className="min-h-12 cursor-pointer rounded-2xl bg-teal-600 px-6 text-sm font-bold text-white transition hover:bg-teal-700 lg:col-span-3 xl:col-span-1">Search</button>
        {placeFilter ? (
          <p className="text-sm text-muted lg:col-span-3 xl:col-span-5">
            Also showing only events in or near “{placeFilter}”. <Link href={withoutPlaceHref} className="font-semibold text-ocean-700 hover:underline">Remove place filter</Link>
          </p>
        ) : null}
      </form>

      <section className="space-y-4 max-md:space-y-2">
        <div className="flex items-end justify-between gap-4 max-md:items-baseline"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700 max-md:hidden">Discover</p><h2 className="text-2xl font-bold text-navy-950 max-md:text-[17px]">Upcoming events</h2></div><span className="text-sm text-muted max-md:text-[13px]">{upcoming.length} found</span></div>
        {upcoming.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 max-md:gap-2">{upcoming.map((event) => <EventCard key={event.id} event={event} />)}</div> : <div className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center"><h3 className="font-bold text-navy-950">{hasFilters ? 'No matching upcoming events' : 'No upcoming events yet'}</h3><p className="mt-1 text-sm text-muted">{hasFilters ? 'Try other filters, or host the session your community needs.' : 'Be the first to host a webinar, masterclass or meetup for the community.'}</p><div className="mt-4 flex justify-center gap-2">{hasFilters ? <Link href="/events" className="rounded-xl border border-mist-200 px-4 py-2 text-sm font-bold text-navy-800 hover:border-ocean-300 hover:bg-mist-50 transition-colors">Clear filters</Link> : null}<Link href="/events/create" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white hover:bg-teal-700 transition-colors">Create event</Link></div></div>}
      </section>

      <PastEventsToggle>
      <section className="space-y-4 border-t border-mist-100 pt-6 max-md:space-y-2 max-md:border-t-0 max-md:pt-0">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-navy-500 max-md:hidden">Knowledge library</p><h2 className="text-2xl font-bold text-navy-950 max-md:text-[17px]">Event archive</h2><p className="mt-1 text-sm text-muted max-md:hidden">Past maritime sessions remain discoverable as a record of community learning and engagement.</p></div>
        {archive.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 max-md:gap-2">{archive.map((event) => <EventCard key={event.id} event={event} showStatus />)}</div> : <div className="rounded-2xl bg-mist-50 p-5 text-sm text-muted">No past events match these filters yet.</div>}
      </section>
      </PastEventsToggle>
    </div>
  )
}

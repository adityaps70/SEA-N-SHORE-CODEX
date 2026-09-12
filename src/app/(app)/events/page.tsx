import Link from 'next/link'
import { Search } from 'lucide-react'
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

function titleCase(value: string) { return value.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()) }
function categoryValue(value?: string): CalendarEventCategory | undefined { return CALENDAR_EVENT_CATEGORIES.find((item) => item === value) }
function typeValue(value?: string): CalendarEventType | undefined { return CALENDAR_EVENT_TYPES.find((item) => item === value) }
function formatValue(value?: string): CalendarEventFormat | undefined { return CALENDAR_EVENT_FORMATS.find((item) => item === value) }

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ q?: string; category?: string; eventType?: string; format?: string; location?: string }> }) {
  const user = await requireAwsUser()
  const params = await searchParams
  const filters = {
    search: params.q ?? '',
    category: categoryValue(params.category),
    eventType: typeValue(params.eventType),
    format: formatValue(params.format),
    location: params.location ?? '',
  }
  const [upcoming, archive] = await Promise.all([
    calendarEventRepository.listDiscoverEvents(user.id, filters),
    calendarEventRepository.listPastEvents(user.id, filters),
  ])

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-navy-950 via-navy-900 to-teal-800 p-6 text-white shadow-xl sm:p-8">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-200">Maritime events</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Learn, meet and move the maritime industry forward.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 sm:text-base">Discover webinars, masterclasses, conferences, meetups and professional sessions hosted by maritime professionals.</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/events" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-navy-950">Discover</Link>
          <Link href="/events/my" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">My Events</Link>
          <Link href="/events/hosting" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">Hosting</Link>
          <Link href="/events/create" className="ml-auto rounded-xl bg-teal-400 px-4 py-2 text-sm font-bold text-navy-950 hover:bg-teal-300">Create event</Link>
        </div>
      </header>

      <form method="get" className="grid gap-3 rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)] lg:grid-cols-[2fr_repeat(3,1fr)_1.4fr_auto]">
        <label className="relative">
          <span className="sr-only">Search events</span>
          <Search className="absolute left-3 top-3.5 h-4 w-4 text-muted" />
          <input name="q" defaultValue={params.q ?? ''} placeholder="Search title, topic, host focus…" className="min-h-11 w-full rounded-xl border border-mist-100 bg-mist-50 pl-10 pr-3 text-sm text-navy-950 outline-none focus:border-navy-300" />
        </label>
        <label><span className="sr-only">Category</span><select name="category" defaultValue={params.category ?? ''} className="min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-navy-900"><option value="">All categories</option>{CALENDAR_EVENT_CATEGORIES.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></label>
        <label><span className="sr-only">Event type</span><select name="eventType" defaultValue={params.eventType ?? ''} className="min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-navy-900"><option value="">All event types</option>{CALENDAR_EVENT_TYPES.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></label>
        <label><span className="sr-only">Format</span><select name="format" defaultValue={params.format ?? ''} className="min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-navy-900"><option value="">Any format</option>{CALENDAR_EVENT_FORMATS.map((value) => <option key={value} value={value}>{titleCase(value)}</option>)}</select></label>
        <label><span className="sr-only">Location</span><input name="location" defaultValue={params.location ?? ''} placeholder="City, country or venue" className="min-h-11 w-full rounded-xl border border-mist-100 bg-white px-3 text-sm text-navy-950 outline-none focus:border-navy-300" /></label>
        <button className="min-h-11 rounded-xl bg-navy-950 px-5 text-sm font-bold text-white">Filter</button>
      </form>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Discover</p><h2 className="text-2xl font-bold text-navy-950">Upcoming events</h2></div><span className="text-sm text-muted">{upcoming.length} found</span></div>
        {upcoming.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{upcoming.map((event) => <EventCard key={event.id} event={event} />)}</div> : <div className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center"><h3 className="font-bold text-navy-950">No matching upcoming events</h3><p className="mt-1 text-sm text-muted">Adjust the filters or host the maritime session your community needs.</p><div className="mt-4 flex justify-center gap-2"><Link href="/events" className="rounded-xl border border-mist-200 px-4 py-2 text-sm font-bold text-navy-800">Clear filters</Link><Link href="/events/create" className="rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white">Host an event</Link></div></div>}
      </section>

      <section className="space-y-4 border-t border-mist-100 pt-6">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-navy-500">Knowledge library</p><h2 className="text-2xl font-bold text-navy-950">Event archive</h2><p className="mt-1 text-sm text-muted">Past maritime sessions remain discoverable as a record of community learning and engagement.</p></div>
        {archive.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{archive.map((event) => <EventCard key={event.id} event={event} showStatus />)}</div> : <div className="rounded-2xl bg-mist-50 p-5 text-sm text-muted">No past events match these filters yet.</div>}
      </section>
    </div>
  )
}

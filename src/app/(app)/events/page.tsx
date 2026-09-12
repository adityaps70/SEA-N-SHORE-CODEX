import Link from 'next/link'
import { Search } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { EventCard } from '@/features/events/components/event-card'

export default async function EventsPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const user = await requireAwsUser()
  const { q = '' } = await searchParams
  const [upcoming, archive] = await Promise.all([
    calendarEventRepository.listDiscoverEvents(user.id, q),
    calendarEventRepository.listPastEvents(user.id, q),
  ])

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
      <header className="overflow-hidden rounded-[2rem] bg-gradient-to-br from-navy-950 via-navy-900 to-teal-800 p-6 text-white shadow-xl sm:p-8">
        <div className="max-w-3xl">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-teal-200">Maritime events</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">Learn, meet and move the maritime industry forward.</h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-white/75 sm:text-base">Discover webinars, masterclasses, conferences, meetups and community sessions hosted by maritime professionals.</p>
        </div>
        <div className="mt-6 flex flex-wrap gap-2">
          <Link href="/events" className="rounded-xl bg-white px-4 py-2 text-sm font-bold text-navy-950">Discover</Link>
          <Link href="/events/my" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">My Events</Link>
          <Link href="/events/hosting" className="rounded-xl bg-white/10 px-4 py-2 text-sm font-semibold text-white hover:bg-white/15">Hosting</Link>
          <Link href="/events/new" className="ml-auto rounded-xl bg-teal-400 px-4 py-2 text-sm font-bold text-navy-950 hover:bg-teal-300">Create event</Link>
        </div>
      </header>

      <form method="get" className="flex gap-2 rounded-2xl border border-mist-100 bg-white p-3 shadow-[var(--shadow-card)]">
        <label className="relative flex-1">
          <span className="sr-only">Search events</span>
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted" />
          <input name="q" defaultValue={q} placeholder="Search SIRE, tanker, careers, leadership, city…" className="min-h-10 w-full rounded-xl border border-mist-100 bg-mist-50 pl-10 pr-3 text-sm text-navy-950 outline-none focus:border-navy-300" />
        </label>
        <button className="rounded-xl bg-navy-950 px-5 text-sm font-bold text-white">Search</button>
      </form>

      <section className="space-y-4">
        <div className="flex items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Discover</p><h2 className="text-2xl font-bold text-navy-950">Upcoming events</h2></div><span className="text-sm text-muted">{upcoming.length} found</span></div>
        {upcoming.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{upcoming.map((event) => <EventCard key={event.id} event={event} />)}</div> : <div className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center"><h3 className="font-bold text-navy-950">No matching upcoming events</h3><p className="mt-1 text-sm text-muted">Try another search or host the maritime session your community needs.</p><Link href="/events/new" className="mt-4 inline-flex rounded-xl bg-teal-600 px-4 py-2 text-sm font-bold text-white">Host an event</Link></div>}
      </section>

      <section className="space-y-4 border-t border-mist-100 pt-6">
        <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-navy-500">Knowledge library</p><h2 className="text-2xl font-bold text-navy-950">Event archive</h2><p className="mt-1 text-sm text-muted">Past maritime sessions remain discoverable as a record of community learning and engagement.</p></div>
        {archive.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{archive.map((event) => <EventCard key={event.id} event={event} showStatus />)}</div> : <div className="rounded-2xl bg-mist-50 p-5 text-sm text-muted">No past events match this search yet.</div>}
      </section>
    </div>
  )
}

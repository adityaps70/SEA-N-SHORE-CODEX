import Link from 'next/link'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { EventCard } from '@/features/events/components/event-card'
import { EventNav } from '@/features/events/components/event-nav'

export default async function HostingEventsPage() {
  const user = await requireAwsUser()
  const events = await calendarEventRepository.listHostedEvents(user.id)
  const upcoming = events.filter((event) => !event.isPast)
  const past = events.filter((event) => event.isPast)
  const cards = (items: typeof events) => items.map((event) => <div key={event.id} className="space-y-2"><EventCard event={event} showStatus />{event.status !== 'cancelled' ? <Link href={`/events/${event.id}/edit`} className="inline-flex text-sm font-bold text-teal-700 hover:text-teal-800">Manage event →</Link> : null}</div>)
  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      <EventNav active="hosting" />
      <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Organizer workspace</p><h1 className="text-3xl font-bold text-navy-950">Hosting</h1><p className="mt-2 text-sm text-muted">Manage drafts, published events, attendee interest and cancellations.</p></div><Link href="/events/create" className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-bold text-white">Create event</Link></div>
      <section className="space-y-4"><h2 className="text-xl font-bold text-navy-950">Upcoming & active</h2>{upcoming.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{cards(upcoming)}</div> : <div className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center text-sm text-muted">You have no upcoming hosted events.</div>}</section>
      <section className="space-y-4 border-t border-mist-100 pt-7"><h2 className="text-xl font-bold text-navy-950">Past</h2>{past.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{cards(past)}</div> : <div className="rounded-2xl bg-mist-50 p-5 text-sm text-muted">Past hosted events will appear here.</div>}</section>
    </div>
  )
}

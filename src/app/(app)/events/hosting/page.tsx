import Link from 'next/link'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { EventCard } from '@/features/events/components/event-card'
import { EventNav } from '@/features/events/components/event-nav'

export default async function HostingEventsPage() {
  const user = await requireAwsUser()
  const events = await calendarEventRepository.listHostedEvents(user.id)
  return <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8"><EventNav active="hosting" /><div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Organizer workspace</p><h1 className="text-3xl font-bold text-navy-950">Hosting</h1><p className="mt-2 text-sm text-muted">Manage drafts, published events, attendee interest and cancellations.</p></div><Link href="/events/new" className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-bold text-white">Create event</Link></div>{events.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{events.map((event) => <div key={event.id} className="space-y-2"><EventCard event={event} showStatus />{event.status !== 'cancelled' ? <Link href={`/events/${event.id}/edit`} className="inline-flex text-sm font-bold text-teal-700 hover:text-teal-800">Edit event →</Link> : null}</div>)}</div> : <div className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center text-sm text-muted">You have not hosted an event yet.</div>}</div>
}

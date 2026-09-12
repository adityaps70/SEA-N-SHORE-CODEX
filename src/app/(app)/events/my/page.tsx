import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { EventCard } from '@/features/events/components/event-card'
import { EventNav } from '@/features/events/components/event-nav'

export default async function MyEventsPage() {
  const user = await requireAwsUser()
  const events = await calendarEventRepository.listMyEvents(user.id)
  return <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 sm:px-6 lg:px-8"><EventNav active="my" /><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Your calendar</p><h1 className="text-3xl font-bold text-navy-950">My Events</h1><p className="mt-2 text-sm text-muted">Events you are attending, with joining details available from each event page.</p></div>{events.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{events.map((event) => <EventCard key={event.id} event={event} showStatus />)}</div> : <div className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center text-sm text-muted">You are not attending any upcoming events yet.</div>}</div>
}

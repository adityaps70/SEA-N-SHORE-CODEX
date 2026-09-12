import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { EventCard } from '@/features/events/components/event-card'
import { EventNav } from '@/features/events/components/event-nav'

export default async function MyEventsPage() {
  const user = await requireAwsUser()
  const [upcoming, past] = await Promise.all([
    calendarEventRepository.listMyEvents(user.id),
    calendarEventRepository.listMyPastEvents(user.id),
  ])
  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-6 sm:px-6 lg:px-8">
      <EventNav active="my" />
      <div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Your calendar</p><h1 className="text-3xl font-bold text-navy-950">My Events</h1><p className="mt-2 text-sm text-muted">Events you are attending, with protected joining details available from each event page.</p></div>
      <section className="space-y-4"><h2 className="text-xl font-bold text-navy-950">Attending</h2>{upcoming.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{upcoming.map((event) => <EventCard key={event.id} event={event} showStatus />)}</div> : <div className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center text-sm text-muted">You are not attending any upcoming events yet.</div>}</section>
      <section className="space-y-4 border-t border-mist-100 pt-7"><h2 className="text-xl font-bold text-navy-950">Past</h2>{past.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">{past.map((event) => <EventCard key={event.id} event={event} showStatus />)}</div> : <div className="rounded-2xl bg-mist-50 p-5 text-sm text-muted">Past events you attended will appear here.</div>}</section>
    </div>
  )
}

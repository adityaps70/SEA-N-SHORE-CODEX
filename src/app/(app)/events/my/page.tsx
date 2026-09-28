import type { Metadata } from 'next'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { EventCard } from '@/features/events/components/event-card'
import { EventNav } from '@/features/events/components/event-nav'
import { PastEventsToggle } from '@/features/events/components/past-events-toggle'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'

export const metadata: Metadata = { title: 'My events' }

export default async function MyEventsPage() {
  const user = await requireAwsUser()
  const [upcoming, past] = await Promise.all([
    calendarEventRepository.listMyEvents(user.id),
    calendarEventRepository.listMyPastEvents(user.id),
  ])
  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 py-2 sm:px-6 sm:py-6 lg:px-8 max-md:space-y-3 max-md:py-0">
      <MobilePageBar backHref="/events" title="My events" className="max-md:mb-0" />
      <EventNav active="my" />
      <div className="max-md:sr-only"><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Your calendar</p><h1 className="text-3xl font-bold text-navy-950">My Events</h1><p className="mt-2 text-sm text-muted">Events you are attending, with protected joining details available from each event page.</p></div>
      <section className="space-y-4 max-md:space-y-2"><h2 className="text-xl font-bold text-navy-950 max-md:text-[17px]">Attending</h2>{upcoming.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 max-md:gap-2">{upcoming.map((event) => <EventCard key={event.id} event={event} showStatus />)}</div> : <div className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center text-sm text-muted">You are not attending any upcoming events yet.</div>}</section>
      <PastEventsToggle><section className="space-y-4 border-t border-mist-100 pt-7 max-md:space-y-2 max-md:border-t-0 max-md:pt-0"><h2 className="text-xl font-bold text-navy-950 max-md:text-[17px]">Past</h2>{past.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 max-md:gap-2">{past.map((event) => <EventCard key={event.id} event={event} showStatus />)}</div> : <div className="rounded-2xl bg-mist-50 p-5 text-sm text-muted">Past events you attended will appear here.</div>}</section></PastEventsToggle>
    </div>
  )
}

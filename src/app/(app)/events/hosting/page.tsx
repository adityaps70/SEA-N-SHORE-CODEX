import type { Metadata } from 'next'
import Link from 'next/link'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { PlanHiddenBanner } from '@/features/billing/components/plan-hidden-banner'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { EventCard } from '@/features/events/components/event-card'
import { EventNav } from '@/features/events/components/event-nav'
import { PastEventsToggle } from '@/features/events/components/past-events-toggle'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'

export const metadata: Metadata = { title: 'Events you host' }

export default async function HostingEventsPage() {
  const user = await requireAwsUser()
  const events = await calendarEventRepository.listHostedEvents(user.id)
  const upcoming = events.filter((event) => !event.isPast)
  const past = events.filter((event) => event.isPast)
  const cards = (items: typeof events) => items.map((event) => <div key={event.id} className="space-y-2">{event.hiddenForPlan ? <PlanHiddenBanner companyId={event.companyId} /> : null}<EventCard event={event} showStatus /><div className="flex flex-wrap gap-x-4 gap-y-1 max-md:gap-x-5 max-md:[&>a]:min-h-11 max-md:[&>a]:items-center">{event.status !== 'cancelled' ? <Link href={`/events/${event.id}/edit`} className="inline-flex text-sm font-bold text-teal-700 hover:text-teal-800">Manage event →</Link> : null}{event.pricing === 'paid' ? <Link href={`/events/${event.id}/registrations`} className="inline-flex text-sm font-bold text-teal-700 hover:text-teal-800">Paid registrations →</Link> : null}</div></div>)
  return (
    <div className="mx-auto w-full max-w-7xl space-y-8 py-2 sm:px-6 sm:py-6 lg:px-8 max-md:space-y-3 max-md:py-0">
      <MobilePageBar backHref="/events" title="Hosting" className="max-md:mb-0" />
      <EventNav active="hosting" />
      {/* Phones: the heading moves to the bar and Create sits in the chip row. */}
      <div className="flex flex-wrap items-end justify-between gap-4 max-md:sr-only"><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Organizer workspace</p><h1 className="text-3xl font-bold text-navy-950">Hosting</h1><p className="mt-2 text-sm text-muted">Manage drafts, published events, attendee interest and cancellations.</p></div><Link href="/events/create" className="rounded-xl bg-teal-600 px-5 py-3 text-sm font-bold text-white hover:bg-teal-700 transition-colors max-md:hidden">Create event</Link></div>
      <section className="space-y-4 max-md:space-y-2"><h2 className="text-xl font-bold text-navy-950 max-md:text-[17px]">Upcoming & active</h2>{upcoming.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 max-md:gap-3">{cards(upcoming)}</div> : <div className="rounded-[1.5rem] border border-dashed border-mist-200 bg-white p-8 text-center text-sm text-muted">You have no upcoming hosted events.</div>}</section>
      <PastEventsToggle><section className="space-y-4 border-t border-mist-100 pt-7 max-md:space-y-2 max-md:border-t-0 max-md:pt-0"><h2 className="text-xl font-bold text-navy-950 max-md:text-[17px]">Past</h2>{past.length ? <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3 max-md:gap-3">{cards(past)}</div> : <div className="rounded-2xl bg-mist-50 p-5 text-sm text-muted">Past hosted events will appear here.</div>}</section></PastEventsToggle>
    </div>
  )
}

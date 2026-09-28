import type { Metadata } from 'next'
import { notFound, redirect } from 'next/navigation'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { EventForm } from '@/features/events/components/event-form'
import { EventNav } from '@/features/events/components/event-nav'
import { getPaymentCapabilities } from '@/features/payments/provider'

export const metadata: Metadata = { title: 'Edit event' }

export default async function EditEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireAwsUser()
  const { eventId } = await params
  const event = await calendarEventRepository.getEvent(eventId, user.id)
  if (!event) notFound()
  if (!event.viewerIsHost) redirect(`/events/${event.id}`)
  if (event.status === 'cancelled') redirect(`/events/${event.id}`)
  const payments = await getPaymentCapabilities()

  return <div className="mx-auto w-full max-w-4xl space-y-6 py-2 sm:px-6 sm:py-6 max-md:space-y-4 max-md:py-0"><MobilePageBar backHref={`/events/${event.id}`} title="Edit event" /><EventNav active="hosting" className="max-md:hidden" /><div className="max-md:sr-only"><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Organizer workspace</p><h1 className="text-3xl font-bold text-navy-950">Edit event</h1><p className="mt-2 text-sm text-muted">Update the published details or keep the event as a draft until it is ready.</p></div><EventForm mode="edit" eventId={event.id} initial={event} paymentsConfigured={payments.configured} paymentCurrencies={payments.currencies} /></div>
}

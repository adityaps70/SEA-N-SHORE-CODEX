import { notFound, redirect } from 'next/navigation'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { EventForm } from '@/features/events/components/event-form'
import { EventNav } from '@/features/events/components/event-nav'

export default async function EditEventPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireAwsUser()
  const { eventId } = await params
  const event = await calendarEventRepository.getEvent(eventId, user.id)
  if (!event) notFound()
  if (!event.viewerIsHost) redirect(`/events/${event.id}`)
  if (event.status === 'cancelled') redirect(`/events/${event.id}`)

  return <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6"><EventNav active="hosting" /><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Organizer workspace</p><h1 className="text-3xl font-bold text-navy-950">Edit event</h1><p className="mt-2 text-sm text-muted">Update the published details or keep the event as a draft until it is ready.</p></div><EventForm mode="edit" eventId={event.id} initial={event} /></div>
}

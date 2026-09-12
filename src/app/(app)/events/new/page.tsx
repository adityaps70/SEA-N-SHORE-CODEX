import { EventForm } from '@/features/events/components/event-form'
import { EventNav } from '@/features/events/components/event-nav'

export default function NewEventPage() {
  return <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6"><EventNav active="hosting" /><div><p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Hosting</p><h1 className="text-3xl font-bold text-navy-950">Create a maritime event</h1><p className="mt-2 text-sm text-muted">Publish a webinar, masterclass, conference, meetup or professional community session.</p></div><EventForm mode="create" /></div>
}

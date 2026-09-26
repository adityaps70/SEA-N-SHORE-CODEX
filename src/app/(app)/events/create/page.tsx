import type { Metadata } from 'next'
import Link from 'next/link'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { EventForm } from '@/features/events/components/event-form'
import { EventNav } from '@/features/events/components/event-nav'
import { buildEventPublisherOptions } from '@/features/events/publishers'
import { organizationRepository } from '@/features/organizations/repository'
import { getOwnProfileFromAurora } from '@/features/profiles/repository'

export const metadata: Metadata = { title: 'Create an event' }

export default async function CreateEventPage() {
  const user = await requireAwsUser()
  const [access, profile, organizations] = await Promise.all([
    getAccessContext(user.id),
    getOwnProfileFromAurora(user.id),
    organizationRepository.listUserOrganizations(user.id),
  ])

  if (!profile) {
    return (
      <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
        <EventNav active="hosting" />
        <section className="rounded-[1.75rem] border border-mist-100 bg-white p-8 text-center shadow-[var(--shadow-card)]">
          <h1 className="text-3xl font-bold text-navy-950">Complete your profile first</h1>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted">
            Sea N Shore needs an active personal profile before an event can be created.
          </p>
          <Link href="/profile/edit" className="mt-5 inline-flex rounded-xl bg-navy-950 px-5 py-2.5 text-sm font-bold text-white">
            Complete profile
          </Link>
        </section>
      </div>
    )
  }

  const publisherOptions = buildEventPublisherOptions(
    access,
    { profileId: profile.id, name: profile.fullName },
    organizations,
  )

  return (
    <div className="mx-auto w-full max-w-4xl space-y-6 px-4 py-6 sm:px-6">
      <EventNav active="hosting" />
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Hosting</p>
        <h1 className="text-3xl font-bold text-navy-950">Create a maritime event</h1>
        <p className="mt-2 text-sm text-muted">
          Choose who is hosting, then create a webinar, masterclass, conference, workshop, meetup or professional community session.
        </p>
      </div>
      <EventForm mode="create" publisherOptions={publisherOptions} />
    </div>
  )
}

import type { Metadata } from 'next'
import Link from 'next/link'
import { BadgeCheck, BookOpen, BriefcaseBusiness, Building2, CalendarDays, CheckCircle2, Crown, ShieldAlert } from 'lucide-react'
import { canUseCapability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'

export const metadata: Metadata = { title: 'Create' }

type CreatorCapability = {
  title: string
  description: string
  capability: 'job.publish' | 'event.publish' | 'course.publish'
  verification: 'recruiter' | 'event_host' | 'trainer'
  href: string
  verificationHref: string
  icon: typeof BriefcaseBusiness
}

const capabilities: CreatorCapability[] = [
  {
    title: 'Post a job',
    description: 'Advertise a sea or shore vacancy under your name as a verified recruiter, or for your company.',
    capability: 'job.publish',
    verification: 'recruiter',
    href: '/hiring/jobs/new',
    verificationHref: '/settings/verifications/recruiter',
    icon: BriefcaseBusiness,
  },
  {
    title: 'Create an event',
    description: 'Host a webinar, masterclass or meetup. You can save drafts now and publish once you are a verified Event Host.',
    capability: 'event.publish',
    verification: 'event_host',
    href: '/events/create',
    verificationHref: '/settings/verifications/event-host',
    icon: CalendarDays,
  },
  {
    title: 'Create a course',
    description: 'Teach what you know. Courses are built in Learning Studio and reviewed by Sea N Shore before they go live.',
    capability: 'course.publish',
    verification: 'trainer',
    href: '/learn/studio/courses/new',
    verificationHref: '/learn/teach',
    icon: BookOpen,
  },
]

export default async function CreatorPage() {
  const user = await requireAwsUser()
  const access = await getAccessContext(user.id)

  return (
    <main className="mx-auto w-full max-w-6xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-navy-950 sm:text-3xl">Create on Sea N Shore</h1>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
            Post jobs, host events and publish courses — for yourself or for your organization. Each option shows what you need before you can publish.
          </p>
        </div>
        <Link href="/plans" className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-mist-100 bg-white px-4 text-sm font-semibold text-navy-950 hover:bg-mist-50">
          <Crown className="size-4" aria-hidden="true" /> View plans
        </Link>
      </header>

      <section className="grid gap-4 lg:grid-cols-3">
        {capabilities.map((item) => {
          const Icon = item.icon
          const personalVerified = access.verifications.includes(item.verification)
          const personalReady = canUseCapability(access, item.capability)
          const organizationReady = access.organizationMemberships.some((membership) =>
            canUseCapability(access, item.capability, { companyId: membership.companyId }))
          const ready = personalReady || organizationReady

          return (
            <article key={item.capability} className="rounded-xl border border-mist-100 bg-white p-5">
              <span className="grid size-11 place-items-center rounded-xl bg-ocean-50 text-ocean-700"><Icon className="size-5" aria-hidden="true" /></span>
              <h2 className="mt-4 text-xl font-bold text-navy-950">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{item.description}</p>

              <div className="mt-4 space-y-2 text-sm">
                <p className={`flex items-center gap-2 font-semibold ${ready ? 'text-emerald-800' : 'text-amber-900'}`}>
                  {ready ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <ShieldAlert className="size-4" aria-hidden="true" />}
                  {ready ? 'You can publish' : 'One step before you can publish'}
                </p>
                {!personalVerified ? <p className="text-xs text-muted">To publish under your own name, get verified first.</p> : null}
                {personalVerified && !personalReady ? <p className="text-xs text-muted">You’re verified — publishing under your own name also needs Creator Pro.</p> : null}
                {organizationReady ? <p className="text-xs text-muted">You can also publish for an organization you manage.</p> : null}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={item.href} className="rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white">{ready ? 'Start' : 'Start a draft'}</Link>
                {!personalVerified ? <Link href={item.verificationHref} className="rounded-xl border border-mist-100 px-4 py-2.5 text-sm font-bold text-navy-950">Get verified</Link> : null}
                {personalVerified && !personalReady ? <Link href="/plans" className="rounded-xl border border-mist-100 px-4 py-2.5 text-sm font-bold text-navy-950">Creator Pro</Link> : null}
              </div>
            </article>
          )
        })}
      </section>

      <section className="rounded-xl border border-mist-100 bg-white p-5">
        <div className="flex items-start gap-3">
          <Building2 className="mt-0.5 size-5 text-ocean-700" aria-hidden="true" />
          <div>
            <h2 className="font-bold text-navy-950">Publishing for an organization?</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              You publish for a company from your own account — there’s no shared company login. Ask the company’s owner on Sea N Shore to give you a role, or create the organization page yourself.
            </p>
            <Link href="/organizations" className="mt-3 inline-flex items-center gap-2 text-sm font-bold text-ocean-700 hover:underline">
              <BadgeCheck className="size-4" aria-hidden="true" /> Manage organization access →
            </Link>
          </div>
        </div>
      </section>
    </main>
  )
}

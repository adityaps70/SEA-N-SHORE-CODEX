import Link from 'next/link'
import { BadgeCheck, BookOpen, BriefcaseBusiness, Building2, CalendarDays, CheckCircle2, Crown, ShieldAlert } from 'lucide-react'
import { canUseCapability } from '@/features/access/policy'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'

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
    title: 'Post maritime jobs',
    description: 'Publish personally as a verified recruiter or through an eligible organization workspace.',
    capability: 'job.publish',
    verification: 'recruiter',
    href: '/hiring/jobs/new',
    verificationHref: '/settings/verifications/recruiter',
    icon: BriefcaseBusiness,
  },
  {
    title: 'Create professional events',
    description: 'Build event drafts and publish after Event Host or organization requirements are satisfied.',
    capability: 'event.publish',
    verification: 'event_host',
    href: '/events/create',
    verificationHref: '/settings/verifications/event-host',
    icon: CalendarDays,
  },
  {
    title: 'Create LMS courses',
    description: 'Build maritime learning as a verified trainer or through an eligible organization LMS role.',
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
      <section className="overflow-hidden rounded-[2rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-200">Creator workspace</p>
            <h1 className="mt-2 text-3xl font-bold sm:text-4xl">Create on Sea N Shore</h1>
            <p className="mt-3 max-w-3xl text-sm leading-6 text-white/75">
              Jobs, Events and LMS use one access model: plan entitlement + relevant verification for personal publishing, or Organization Pro + verified workspace + authorized organization role.
            </p>
          </div>
          <Link href="/plans" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-white px-4 text-sm font-bold text-navy-950">
            <Crown className="size-4" aria-hidden="true" /> View plans
          </Link>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {capabilities.map((item) => {
          const Icon = item.icon
          const personalVerified = access.verifications.includes(item.verification)
          const personalReady = canUseCapability(access, item.capability)
          const organizationReady = access.organizationMemberships.some((membership) =>
            canUseCapability(access, item.capability, { companyId: membership.companyId }))
          const ready = personalReady || organizationReady

          return (
            <article key={item.capability} className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
              <span className="grid size-11 place-items-center rounded-xl bg-ocean-50 text-ocean-700"><Icon className="size-5" aria-hidden="true" /></span>
              <h2 className="mt-4 text-xl font-bold text-navy-950">{item.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">{item.description}</p>

              <div className="mt-4 space-y-2 text-sm">
                <p className={`flex items-center gap-2 font-semibold ${ready ? 'text-emerald-800' : 'text-amber-900'}`}>
                  {ready ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <ShieldAlert className="size-4" aria-hidden="true" />}
                  {ready ? 'A publishing identity is ready' : 'Publishing setup required'}
                </p>
                {!personalVerified ? <p className="text-xs text-muted">Personal path: relevant verification not yet approved.</p> : null}
                {personalVerified && !personalReady ? <p className="text-xs text-muted">Personal path: Creator Pro entitlement is still required.</p> : null}
                {organizationReady ? <p className="text-xs text-muted">Organization path: at least one workspace is eligible.</p> : null}
              </div>

              <div className="mt-5 flex flex-wrap gap-2">
                <Link href={item.href} className="rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white">Open creator flow</Link>
                {!personalVerified ? <Link href={item.verificationHref} className="rounded-xl border border-mist-100 px-4 py-2.5 text-sm font-bold text-navy-950">Get verified</Link> : null}
                {personalVerified && !personalReady ? <Link href="/plans" className="rounded-xl border border-mist-100 px-4 py-2.5 text-sm font-bold text-navy-950">Creator Pro</Link> : null}
              </div>
            </article>
          )
        })}
      </section>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex items-start gap-3">
          <Building2 className="mt-0.5 size-5 text-ocean-700" aria-hidden="true" />
          <div>
            <h2 className="font-bold text-navy-950">Publishing for an organization?</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Organization publishing never uses a shared company login. Your personal account must hold the correct approved workspace role and the organization must satisfy verification and plan requirements.
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

import Link from 'next/link'
import { CalendarDays, CheckCircle2, Clock3, ShieldAlert, UserSearch } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { creatorVerificationRepository } from '@/features/verifications/repository'
import type { CreatorVerificationState } from '@/features/verifications/application'

function statusDetails(state: CreatorVerificationState | null) {
  if (!state) return { label: 'Not applied', tone: 'bg-mist-50 text-muted' }
  if (state.status === 'approved') return { label: 'Verified', tone: 'bg-emerald-50 text-emerald-800' }
  if (state.status === 'pending') return { label: 'Under review', tone: 'bg-amber-50 text-amber-900' }
  if (state.status === 'suspended') return { label: 'Suspended', tone: 'bg-red-50 text-red-800' }
  return { label: 'Action required', tone: 'bg-orange-50 text-orange-900' }
}

function VerificationCard({
  title,
  description,
  href,
  state,
  icon: Icon,
}: {
  title: string
  description: string
  href: string
  state: CreatorVerificationState | null
  icon: typeof UserSearch
}) {
  const status = statusDetails(state)
  const actionable = !state || state.status === 'rejected'

  return (
    <article className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex items-start gap-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-700">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold text-navy-950">{title}</h2>
            <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.tone}`}>{status.label}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
        </div>
      </div>

      {state?.reviewNote ? (
        <div className="mt-4 rounded-xl bg-mist-50 p-4 text-sm leading-6 text-navy-900">
          <span className="font-semibold">Review note:</span> {state.reviewNote}
        </div>
      ) : null}

      <div className="mt-5">
        {actionable ? (
          <Link href={href} className="inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-bold text-white">
            {state?.status === 'rejected' ? 'Update and resubmit' : 'Apply for verification'}
          </Link>
        ) : state?.status === 'pending' ? (
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-amber-900">
            <Clock3 aria-hidden="true" className="size-4" /> Sea N Shore review in progress
          </span>
        ) : state?.status === 'approved' ? (
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-emerald-800">
            <CheckCircle2 aria-hidden="true" className="size-4" /> Approved professional verification
          </span>
        ) : (
          <span className="inline-flex items-center gap-2 text-sm font-semibold text-red-800">
            <ShieldAlert aria-hidden="true" className="size-4" /> Contact Sea N Shore support about this verification
          </span>
        )}
      </div>
    </article>
  )
}

export default async function VerificationSettingsPage() {
  const user = await requireAwsUser()
  const [recruiter, eventHost] = await Promise.all([
    creatorVerificationRepository.getState(user.id, 'recruiter'),
    creatorVerificationRepository.getState(user.id, 'event_host'),
  ])

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Trust & professional capabilities</p>
        <h1 className="mt-2 text-3xl font-bold text-navy-950">Verifications</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
          Verification confirms that Sea N Shore has reviewed your professional experience for a specific capability. Each verification is independent.
        </p>
      </div>

      <div className="rounded-xl border border-ocean-100 bg-ocean-50/60 px-4 py-3 text-sm leading-6 text-navy-900">
        <strong>Verification does not activate a paid plan.</strong> Publishing still requires the relevant Creator Pro entitlement. Organization publishing uses the organization&apos;s own verification, role and plan.
      </div>

      <section className="grid gap-4 md:grid-cols-2">
        <VerificationCard
          title="Recruiter verification"
          description="For independent recruiters and crewing professionals who want to publish jobs under their personal professional identity."
          href="/settings/verifications/recruiter"
          state={recruiter}
          icon={UserSearch}
        />
        <VerificationCard
          title="Event Host verification"
          description="For independent organizers who want to publish maritime webinars, workshops, conferences or professional community events personally."
          href="/settings/verifications/event-host"
          state={eventHost}
          icon={CalendarDays}
        />
      </section>

      <Link href="/settings" className="inline-flex text-sm font-bold text-navy-950 hover:underline">
        ← Back to Settings
      </Link>
    </main>
  )
}

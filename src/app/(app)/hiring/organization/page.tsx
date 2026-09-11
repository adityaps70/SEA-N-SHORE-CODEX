import Link from 'next/link'
import { redirect } from 'next/navigation'
import { AlertTriangle, Building2, CheckCircle2, Clock3, ShieldAlert } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { OrganizationApplicationForm } from '@/features/organizations/components/organization-application-form'
import { organizationRepository } from '@/features/organizations/repository'

function ReviewHeader({ organizationName }: { organizationName?: string }) {
  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Sea N Shore Hiring</p>
        <h1 className="mt-2 text-3xl font-bold text-navy-950">Organization verification</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          {organizationName
            ? `Track the employer review for ${organizationName}.`
            : 'Create your employer identity once. After approval, Hiring and job posting unlock automatically.'}
        </p>
      </div>
      <Link href="/hiring" className="text-sm font-bold text-navy-950 hover:underline">Back to Hiring</Link>
    </div>
  )
}

function ReviewNote({ note }: { note: string | null }) {
  if (!note) return null
  return (
    <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4">
      <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-800">Sea N Shore review note</p>
      <p className="mt-2 text-sm leading-6 text-amber-950">{note}</p>
    </div>
  )
}

function formatSubmittedAt(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date)
}

function StatusPanel({
  title,
  description,
  tone,
  note,
}: {
  title: string
  description: string
  tone: 'pending' | 'changes' | 'rejected' | 'suspended'
  note: string | null
}) {
  const Icon = tone === 'pending' ? Clock3 : tone === 'changes' ? AlertTriangle : ShieldAlert
  const classes = tone === 'pending'
    ? 'border-sky-100 bg-sky-50 text-sky-900'
    : tone === 'changes'
      ? 'border-amber-100 bg-amber-50 text-amber-950'
      : 'border-red-100 bg-red-50 text-red-900'

  return (
    <section className={`rounded-[1.5rem] border p-5 sm:p-6 ${classes}`}>
      <div className="flex gap-4">
        <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-white/75">
          <Icon aria-hidden="true" className="size-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 opacity-80">{description}</p>
        </div>
      </div>
      <ReviewNote note={note} />
    </section>
  )
}

export default async function HiringOrganizationPage() {
  const user = await requireAwsUser()
  const state = await organizationRepository.getUserOrganizationState(user.id)

  if (state.kind === 'none') {
    return (
      <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
        <ReviewHeader />
        <section className="rounded-[1.5rem] border border-mist-100 bg-navy-950 p-5 text-white shadow-[var(--shadow-card)] sm:p-6">
          <div className="flex gap-4">
            <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-white/10">
              <Building2 aria-hidden="true" className="size-6" />
            </div>
            <div>
              <h2 className="text-xl font-bold">Create your verified employer profile</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-white/70">
                This is the organization identity Sea N Shore will review before owners, administrators or recruiters can manage vacancies.
              </p>
            </div>
          </div>
        </section>
        <OrganizationApplicationForm mode="create" />
      </main>
    )
  }

  if (state.status === 'approved') redirect('/hiring')

  const editable = state.status === 'changes_requested' || state.status === 'rejected'
    ? await organizationRepository.getOrganizationApplication(user.id, state.applicationId)
    : null

  return (
    <main className="mx-auto w-full max-w-5xl space-y-6 px-4 py-8 sm:px-6 lg:px-8">
      <ReviewHeader organizationName={state.company.name} />

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-mist-100 bg-white px-4 py-3 text-sm text-muted shadow-[var(--shadow-card)]">
        <span className="font-semibold text-navy-950">{state.company.name}</span>
        <span aria-hidden="true">·</span>
        <span>Submitted <time dateTime={state.submittedAt}>{formatSubmittedAt(state.submittedAt)}</time></span>
      </div>

      {state.status === 'pending' ? (
        <StatusPanel
          title="Verification in progress"
          description="Your organization application is in the Sea N Shore review queue. Hiring activates automatically after the company and founding owner are approved."
          tone="pending"
          note={state.adminReviewNote}
        />
      ) : null}

      {state.status === 'changes_requested' ? (
        <StatusPanel
          title="Changes requested"
          description="Sea N Shore needs updated information before the organization can be approved. Review the note, update the application and resubmit it below."
          tone="changes"
          note={state.adminReviewNote}
        />
      ) : null}

      {state.status === 'rejected' ? (
        <StatusPanel
          title="Application rejected"
          description="The previous review was not approved. You can use the explicit resubmission form below when you have corrected or strengthened the organization information."
          tone="rejected"
          note={state.adminReviewNote}
        />
      ) : null}

      {state.status === 'suspended' ? (
        <StatusPanel
          title="Hiring access suspended"
          description="This organization cannot post or manage jobs while suspended. A suspended organization cannot reactivate itself; contact Sea N Shore if review is required."
          tone="suspended"
          note={state.adminReviewNote}
        />
      ) : null}

      {editable ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 rounded-2xl border border-mist-100 bg-white p-4 shadow-[var(--shadow-card)]">
            <CheckCircle2 aria-hidden="true" className="size-5 text-teal-700" />
            <p className="text-sm text-muted">Update the existing employer record; Sea N Shore will review the resubmitted application from the beginning.</p>
          </div>
          <OrganizationApplicationForm mode="resubmit" applicationId={state.applicationId} initial={editable} />
        </div>
      ) : null}
    </main>
  )
}

import Link from 'next/link'
import { notFound } from 'next/navigation'
import { CheckCircle2, Clock3, ShieldAlert } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getOwnProfileFromAurora } from '@/features/profiles/repository'
import { CreatorVerificationForm } from '@/features/verifications/components/creator-verification-form'
import type { CreatorVerificationType } from '@/features/verifications/application'
import { creatorVerificationRepository } from '@/features/verifications/repository'

function verificationTypeFromSlug(value: string): CreatorVerificationType | null {
  if (value === 'recruiter') return 'recruiter'
  if (value === 'event-host') return 'event_host'
  return null
}

function statusCopy(type: CreatorVerificationType, status: 'pending' | 'approved' | 'suspended') {
  const name = type === 'recruiter' ? 'Recruiter' : 'Event Host'
  if (status === 'approved') {
    return {
      title: `${name} verification approved`,
      copy: 'Your professional verification is active. Paid publishing access is still controlled separately by your plan and entitlements.',
      icon: CheckCircle2,
      tone: 'bg-emerald-50 text-emerald-900',
    }
  }
  if (status === 'suspended') {
    return {
      title: `${name} verification suspended`,
      copy: 'This verification is currently suspended. Existing account data remains intact, but this verification cannot satisfy publishing requirements until the review is resolved.',
      icon: ShieldAlert,
      tone: 'bg-red-50 text-red-900',
    }
  }
  return {
    title: `${name} application under review`,
    copy: 'Sea N Shore is reviewing the submitted professional evidence. Editing is locked while the review is pending so the submitted evidence remains consistent.',
    icon: Clock3,
    tone: 'bg-amber-50 text-amber-950',
  }
}

export default async function CreatorVerificationApplicationPage({
  params,
}: {
  params: Promise<{ verificationType: string }>
}) {
  const { verificationType: slug } = await params
  const type = verificationTypeFromSlug(slug)
  if (!type) notFound()

  const user = await requireAwsUser()
  const [state, profile] = await Promise.all([
    creatorVerificationRepository.getState(user.id, type),
    getOwnProfileFromAurora(user.id),
  ])

  if (state && (state.status === 'pending' || state.status === 'approved' || state.status === 'suspended')) {
    const status = statusCopy(type, state.status)
    const Icon = status.icon
    return (
      <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
        <section className={`rounded-[1.5rem] p-6 ${status.tone}`}>
          <div className="flex items-start gap-3">
            <Icon aria-hidden="true" className="mt-1 size-6 shrink-0" />
            <div>
              <h1 className="text-2xl font-bold">{status.title}</h1>
              <p className="mt-2 text-sm leading-6">{status.copy}</p>
              {state.reviewNote ? <p className="mt-3 text-sm"><strong>Review note:</strong> {state.reviewNote}</p> : null}
            </div>
          </div>
        </section>
        <Link href="/settings/verifications" className="inline-flex text-sm font-bold text-navy-950 hover:underline">
          ← Back to Verifications
        </Link>
      </main>
    )
  }

  const existing = state?.application
  const initialValue = existing ?? {
    professionalRole: profile?.headline ?? '',
    organizationName: profile?.currentCompany ?? '',
    experienceYears: '',
    specializations: '',
    experienceSummary: profile?.summary && profile.summary.length >= 60 ? profile.summary : '',
    evidenceUrl: '',
    additionalNote: '',
  }

  return (
    <main className="mx-auto w-full max-w-4xl space-y-5 px-4 py-8 sm:px-6 lg:px-8">
      {state?.status === 'rejected' ? (
        <section className="rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm leading-6 text-orange-950">
          <strong>Changes are needed before approval.</strong>
          {state.reviewNote ? <> Review note: {state.reviewNote}</> : null}
        </section>
      ) : null}
      <CreatorVerificationForm type={type} initialValue={initialValue} />
      <Link href="/settings/verifications" className="inline-flex text-sm font-bold text-navy-950 hover:underline">
        ← Back to Verifications
      </Link>
    </main>
  )
}

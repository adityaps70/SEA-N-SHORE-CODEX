import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, Clock3, ShieldAlert, Sparkles } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { MentorApplicationForm } from '@/features/learning/components/mentor-application-form'
import type { MentorApplicationInput } from '@/features/learning/mentor-application'
import { learningRepository } from '@/features/learning/repository'
import { getAwsOwnProfile } from '@/features/profiles/aws-queries'

function SectionShell({ children }: { children: React.ReactNode }) {
  return (
    <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      {children}
    </section>
  )
}

function StatusCard({
  eyebrow,
  title,
  copy,
  icon: Icon,
}: {
  eyebrow: string
  title: string
  copy: string
  icon: typeof Clock3
}) {
  return (
    <SectionShell>
      <div className="flex items-start gap-4">
        <span className="grid size-11 shrink-0 place-items-center rounded-2xl bg-mist-50 text-navy-950">
          <Icon aria-hidden="true" className="size-5" />
        </span>
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">{eyebrow}</p>
          <h2 className="mt-1 text-xl font-bold text-navy-950">{title}</h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">{copy}</p>
        </div>
      </div>
    </SectionShell>
  )
}

function firstApplicationValue(
  profile: NonNullable<Awaited<ReturnType<typeof getAwsOwnProfile>>>,
): MentorApplicationInput {
  const experience = profile.sailingExperienceYears ?? 0
  const skillSummary = profile.skills.length ? profile.skills.join(', ') : profile.summary ?? ''

  return {
    name: profile.fullName,
    currentLastRank: profile.rank ?? profile.headline ?? '',
    yearsExperience: experience,
    vesselTypes: profile.vesselTypes,
    specialization: skillSummary,
    certifications: [],
    linkedInUrl: null,
    shortBio: profile.summary ?? '',
    profilePhotoPath: profile.avatarPath,
    proposedCourseTopics: [],
  }
}

export default async function TeachPage() {
  const user = await requireAwsUser()
  const state = await learningRepository.getMentorApplicationState(user.id)

  if (state.kind === 'mentor' && state.mentorStatus === 'active') {
    redirect('/learn/studio')
  }

  let content: React.ReactNode

  if (state.kind === 'none') {
    const profile = await getAwsOwnProfile()
    content = profile ? (
      <SectionShell>
        <MentorApplicationForm initialValue={firstApplicationValue(profile)} />
      </SectionShell>
    ) : (
      <StatusCard
        eyebrow="Profile required"
        title="Complete your Sea N Shore profile before applying"
        copy="Your trainer verification application is connected to your verified Sea N Shore identity. Complete your professional profile first so your maritime rank, experience and vessel background can be carried into the application safely."
        icon={ShieldAlert}
      />
    )
  } else if (state.kind === 'mentor' && state.mentorStatus === 'suspended') {
    content = (
      <StatusCard
        eyebrow="Access review"
        title="Mentor access is temporarily suspended"
        copy="Learning Studio remains locked while your trainer verification is under review. Existing learning records remain protected; contact the Sea N Shore team if you need clarification about the review."
        icon={ShieldAlert}
      />
    )
  } else if (state.kind === 'application' && state.status === 'pending') {
    content = (
      <StatusCard
        eyebrow="Review in progress"
        title="Application under review"
        copy="The Sea N Shore Learning team is reviewing your maritime background, credentials, practical expertise and proposed teaching areas. Editing is locked while this review is active so the submitted evidence remains consistent."
        icon={Clock3}
      />
    )
  } else if (state.kind === 'application' && (state.status === 'changes_requested' || state.status === 'rejected')) {
    const existing = await learningRepository.getMentorApplication(user.id, state.applicationId)
    content = existing ? (
      <SectionShell>
        <MentorApplicationForm
          initialValue={existing}
          applicationId={state.applicationId}
          reviewNote={state.adminReviewNote}
        />
      </SectionShell>
    ) : (
      <StatusCard
        eyebrow="Application unavailable"
        title="We could not load your trainer verification application"
        copy="Your trainer verification application status is recorded, but the editable details could not be loaded safely. Return to Learning and try again before making another submission."
        icon={ShieldAlert}
      />
    )
  } else {
    content = (
      <StatusCard
        eyebrow="Approval processing"
        title="Your trainer verification is being finalized"
        copy="Your application has been approved and Sea N Shore is finalizing your mentor workspace. Learning Studio will unlock only after the approved mentor record is active."
        icon={Sparkles}
      />
    )
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/learn" className="inline-flex items-center gap-2 text-sm font-bold text-muted transition hover:text-navy-950">
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to Learning
      </Link>

      <section className="mt-5 overflow-hidden rounded-[1.75rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8">
        <div className="grid gap-6 lg:grid-cols-[1.35fr_0.65fr] lg:items-end">
          <div>
            <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-200">
              <Sparkles aria-hidden="true" className="size-4" /> Verified maritime expertise
            </p>
            <h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl">Teach on Sea N Shore</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-white/72 sm:text-base">
              Help maritime professionals learn from real sea and shore experience. Trainer verification establishes trust; Creator Pro or an eligible Organization Pro workspace provides the publishing entitlement. Courses still pass Sea N Shore quality review before publication.
            </p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-white/5 p-4 text-sm leading-6 text-white/75">
            <p className="font-bold text-white">What we review</p>
            <p className="mt-1">Professional background, credentials, practical expertise, teaching fit and the value of your proposed course topics.</p>
          </div>
        </div>
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div>{content}</div>
        <aside className="space-y-4">
          <article className="rounded-[1.35rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-teal-700">Trainer standard</p>
            <h2 className="mt-2 text-lg font-bold text-navy-950">Practical. Credible. Reviewed.</h2>
            <p className="mt-2 text-sm leading-6 text-muted">Verified trainers do not publish automatically. Courses move through Sea N Shore review before they become available to learners.</p>
          </article>
          <article className="rounded-[1.35rem] border border-mist-100 bg-mist-50 p-5">
            <p className="text-sm font-bold text-navy-950">Built for maritime careers</p>
            <p className="mt-2 text-sm leading-6 text-muted">Deck, Engine, Tankers, LNG/LPG, Offshore, SIRE 2.0, Safety, Maritime Law, Leadership, Human Factors, Shore Careers, Mental Health and assessments.</p>
          </article>
        </aside>
      </div>
    </main>
  )
}

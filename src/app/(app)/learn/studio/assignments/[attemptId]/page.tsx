import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, ExternalLink, FileText, History } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { assignmentGradingRepository } from '@/features/learning/assignment-grading-repository'
import { AssignmentGradingControl } from '@/features/learning/components/assignment-grading-control'
import { learningRepository } from '@/features/learning/repository'
import { organizationRepository } from '@/features/organizations/repository'
import { createMediaReadUrl } from '@/lib/aws/storage'

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default async function MentorAssignmentReviewPage({ params }: { params: Promise<{ attemptId: string }> }) {
  const user = await requireAwsUser()
  const [mentorState, organizations] = await Promise.all([
    learningRepository.getMentorApplicationState(user.id),
    organizationRepository.listUserOrganizations(user.id),
  ])
  const hasActiveMentor = mentorState.kind === 'mentor' && mentorState.mentorStatus === 'active'
  const hasOrganizationLmsAccess = organizations.some((organization) =>
    organization.role === 'owner'
    || organization.role === 'administrator'
    || organization.role === 'lms_manager')
  if (!hasActiveMentor && !hasOrganizationLmsAccess) return redirect('/learn/teach')

  const { attemptId } = await params
  const review = await assignmentGradingRepository.getForMentor(user.id, attemptId)
  if (!review) return notFound()

  const attachmentUrl = review.attachmentPath ? await createMediaReadUrl(review.attachmentPath) : null

  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/learn/studio/assignments" className="inline-flex items-center gap-2 text-sm font-bold text-muted transition hover:text-navy-950">
        <ArrowLeft className="size-4" aria-hidden="true" /> Assignment grading
      </Link>

      <section className="mt-5 overflow-hidden rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-200">{review.courseTitle}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight">{review.lessonTitle}</h1>
            <p className="mt-3 text-sm font-bold text-white">{review.learnerName}</p>
            <p className="mt-1 text-sm text-white/68">Attempt {review.attemptNumber} · Submitted {dateLabel(review.submittedAt)}</p>
          </div>
          <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${review.status === 'submitted' ? 'border-amber-300/30 bg-amber-300/10 text-amber-100' : review.passed ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100' : 'border-rose-300/30 bg-rose-300/10 text-rose-100'}`}>
            {review.status === 'submitted' ? 'Awaiting review' : review.passed ? 'Passed' : 'Needs revision'}
          </span>
        </div>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        <div className="space-y-5">
          <section className="rounded-[1.4rem] border border-mist-200 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Assignment instructions</p>
            <div className="mt-3 whitespace-pre-wrap text-sm leading-7 text-navy-900">{review.assignmentInstructions}</div>
          </section>

          <section className="rounded-[1.4rem] border border-mist-200 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
            <div className="flex items-center gap-2">
              <FileText className="size-5 text-teal-700" aria-hidden="true" />
              <h2 className="text-lg font-bold text-navy-950">Learner response</h2>
            </div>
            <div className="mt-4 whitespace-pre-wrap rounded-2xl border border-mist-100 bg-mist-50 p-4 text-sm leading-7 text-navy-900">
              {review.responseText || 'No written response was provided.'}
            </div>
            {attachmentUrl ? (
              <a
                href={attachmentUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-4 inline-flex items-center gap-2 rounded-xl border border-mist-200 bg-white px-4 py-2.5 text-sm font-bold text-navy-950 transition hover:border-teal-300 hover:text-teal-800"
              >
                Open learner attachment <ExternalLink className="size-4" aria-hidden="true" />
              </a>
            ) : null}
          </section>

          {review.previousAttempts.length ? (
            <section className="rounded-[1.4rem] border border-mist-200 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
              <div className="flex items-center gap-2">
                <History className="size-5 text-teal-700" aria-hidden="true" />
                <h2 className="text-lg font-bold text-navy-950">Previous attempts</h2>
              </div>
              <div className="mt-4 space-y-3">
                {review.previousAttempts.map((attempt) => (
                  <article key={attempt.id} className="rounded-2xl border border-mist-100 bg-mist-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="text-sm font-bold text-navy-950">Attempt {attempt.attemptNumber} · {dateLabel(attempt.submittedAt)}</p>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${attempt.passed ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
                        {attempt.passed ? 'Passed' : 'Needs revision'}
                      </span>
                    </div>
                    <div className="mt-3 whitespace-pre-wrap text-sm leading-6 text-navy-900">{attempt.responseText || 'No written response was provided.'}</div>
                    {attempt.scorePoints !== null ? <p className="mt-3 text-sm font-bold text-navy-950">Score {attempt.scorePoints}/{review.maxPoints} · {attempt.percentage}%</p> : null}
                    {attempt.feedback ? (
                      <div className="mt-3 rounded-xl border border-teal-100 bg-white p-3 text-sm leading-6 text-muted">
                        <span className="font-bold text-navy-950">Trainer feedback:</span> {attempt.feedback}
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            </section>
          ) : null}
        </div>

        <aside className="rounded-[1.4rem] border border-mist-200 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6 lg:sticky lg:top-24">
          {review.status === 'submitted' ? (
            <>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Trainer grading</p>
              <h2 className="mt-1 text-xl font-bold text-navy-950">Review this attempt</h2>
              <p className="mt-2 text-sm leading-6 text-muted">Passing threshold: {review.passingPercentage}% of {review.maxPoints} points.</p>
              <div className="mt-5">
                <AssignmentGradingControl attemptId={review.id} maxPoints={review.maxPoints} passingPercentage={review.passingPercentage} />
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Published grade</p>
              <h2 className="mt-1 text-xl font-bold text-navy-950">{review.passed ? 'Passed' : 'Needs revision'}</h2>
              <p className="mt-3 text-2xl font-bold text-navy-950">{review.scorePoints}/{review.maxPoints} <span className="text-base text-muted">· {review.percentage}%</span></p>
              {review.feedback ? <p className="mt-4 rounded-xl bg-mist-50 p-4 text-sm leading-6 text-muted">{review.feedback}</p> : null}
              {review.gradedAt ? <p className="mt-3 text-xs font-semibold text-muted">Graded {dateLabel(review.gradedAt)}</p> : null}
            </>
          )}
        </aside>
      </div>
    </main>
  )
}

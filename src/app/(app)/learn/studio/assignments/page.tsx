import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowLeft, ArrowRight, CheckCircle2, Clock3 } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { assignmentGradingRepository } from '@/features/learning/assignment-grading-repository'
import { learningRepository } from '@/features/learning/repository'

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export default async function MentorAssignmentsPage() {
  const user = await requireAwsUser()
  const mentorState = await learningRepository.getMentorApplicationState(user.id)
  if (mentorState.kind !== 'mentor' || mentorState.mentorStatus !== 'active') return redirect('/learn/teach')

  const attempts = await assignmentGradingRepository.listForMentor(user.id)
  const pending = attempts.filter((attempt) => attempt.status === 'submitted')
  const graded = attempts.filter((attempt) => attempt.status === 'graded')

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8">
      <Link href="/learn/studio" className="inline-flex items-center gap-2 text-sm font-bold text-muted hover:text-navy-950">
        <ArrowLeft className="size-4" aria-hidden="true" /> Mentor Studio
      </Link>
      <section className="mt-5 rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-200">Assessment desk</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight">Assignment grading</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">Review learner evidence, publish a score and practical feedback, and unlock progress only when the configured pass mark is met.</p>
        <div className="mt-5 flex flex-wrap gap-3 text-sm font-semibold">
          <span className="rounded-full bg-white/10 px-3 py-1.5">{pending.length} awaiting review</span>
          <span className="rounded-full bg-white/10 px-3 py-1.5">{graded.length} graded</span>
        </div>
      </section>

      <section className="mt-7">
        <div className="flex items-center gap-2">
          <Clock3 className="size-5 text-amber-700" aria-hidden="true" />
          <h2 className="text-xl font-bold text-navy-950">Awaiting review</h2>
        </div>
        {pending.length ? (
          <div className="mt-4 space-y-4">
            {pending.map((attempt) => (
              <article key={attempt.id} className="rounded-[1.5rem] border border-mist-200 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700">{attempt.courseTitle}</p>
                    <h3 className="mt-1 text-lg font-bold text-navy-950">{attempt.lessonTitle}</h3>
                    <p className="mt-3 text-sm font-bold text-navy-950">{attempt.learnerName}</p>
                    <p className="mt-1 text-sm text-muted">Attempt {attempt.attemptNumber} · Submitted {dateLabel(attempt.submittedAt)}</p>
                  </div>
                  <div className="flex flex-col items-end gap-3">
                    <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-900">Pending</span>
                    <Link
                      href={`/learn/studio/assignments/${attempt.id}`}
                      aria-label={`Review ${attempt.learnerName} submission`}
                      className="inline-flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-bold text-white transition hover:bg-navy-900"
                    >
                      Review submission <ArrowRight className="size-4" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
                <div className="mt-4 line-clamp-3 whitespace-pre-wrap rounded-2xl border border-mist-100 bg-mist-50 p-4 text-sm leading-7 text-navy-900">
                  {attempt.responseText || 'Attachment-only submission'}
                </div>
              </article>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-mist-200 bg-white p-6 text-sm text-muted">No assignment submissions are waiting for review.</div>
        )}
      </section>

      {graded.length ? (
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="size-5 text-emerald-700" aria-hidden="true" />
            <h2 className="text-xl font-bold text-navy-950">Graded history</h2>
          </div>
          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {graded.slice(0, 20).map((attempt) => (
              <article key={attempt.id} className="rounded-2xl border border-mist-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold text-navy-950">{attempt.learnerName}</p>
                    <p className="mt-1 text-sm text-muted">{attempt.courseTitle} · {attempt.lessonTitle}</p>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${attempt.passed ? 'bg-emerald-50 text-emerald-800' : 'bg-rose-50 text-rose-800'}`}>
                    {attempt.passed ? 'Passed' : 'Retry needed'}
                  </span>
                </div>
                <p className="mt-3 text-sm font-bold text-navy-950">{attempt.scorePoints}/{attempt.maxPoints} · {attempt.percentage}%</p>
                {attempt.feedback ? <p className="mt-2 text-sm leading-6 text-muted">{attempt.feedback}</p> : null}
                <Link
                  href={`/learn/studio/assignments/${attempt.id}`}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-bold text-teal-800 hover:text-teal-700"
                >
                  View review <ArrowRight className="size-4" aria-hidden="true" />
                </Link>
              </article>
            ))}
          </div>
        </section>
      ) : null}
    </main>
  )
}

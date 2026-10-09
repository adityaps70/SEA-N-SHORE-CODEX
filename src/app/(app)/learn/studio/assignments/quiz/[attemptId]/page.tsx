import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, CheckCircle2, PenLine, XCircle } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { QuizGradingControl } from '@/features/learning/components/quiz-grading-control'
import { quizGradingRepository, type MentorQuizAnswer } from '@/features/learning/quiz-grading-repository'
import { QUESTION_TYPE_SHORT_LABELS, marksLabel } from '@/features/learning/quiz-model'
import { learningRepository } from '@/features/learning/repository'
import { organizationRepository } from '@/features/organizations/repository'

export const metadata: Metadata = { title: 'Grade quiz answers' }

function dateLabel(value: string) {
  return new Intl.DateTimeFormat('en-IN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function AnswerSummary({ answer, number }: { answer: MentorQuizAnswer; number: number }) {
  const written = answer.type === 'subjective'
  return (
    <article className="rounded-2xl border border-mist-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-[0.12em] text-teal-700">Question {number} · {QUESTION_TYPE_SHORT_LABELS[answer.type]}</p>
        <span className="text-xs font-bold text-navy-950">
          {answer.pointsAwarded === null ? `— / ${marksLabel(answer.maxPoints)}` : `${marksLabel(answer.pointsAwarded)} / ${marksLabel(answer.maxPoints)}`}
        </span>
      </div>
      <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-navy-950">{answer.prompt}</p>
      {written ? (
        <div className="mt-3 whitespace-pre-wrap rounded-xl border border-mist-100 bg-mist-50 p-3 text-sm leading-7 text-navy-900">{answer.textResponse || 'No answer was written.'}</div>
      ) : (
        <div className="mt-2 space-y-1 text-sm">
          <p className={`inline-flex items-center gap-1.5 font-semibold ${answer.isCorrect ? 'text-emerald-700' : 'text-rose-700'}`}>
            {answer.isCorrect ? <CheckCircle2 className="size-4" aria-hidden="true" /> : <XCircle className="size-4" aria-hidden="true" />}
            {answer.isCorrect ? 'Correct' : 'Incorrect'}
          </p>
          <p className="text-muted">Answer: {answer.textResponse ?? (answer.selectedLabels.join('; ') || 'Not answered')}</p>
          {!answer.isCorrect ? <p className="text-muted">Key: {answer.correctLabels.join('; ') || answer.acceptedAnswers.join('; ')}</p> : null}
        </div>
      )}
      {answer.feedback ? <p className="mt-3 rounded-xl bg-teal-50 p-3 text-sm leading-6 text-teal-950"><span className="font-bold">Feedback:</span> {answer.feedback}</p> : null}
    </article>
  )
}

export default async function QuizGradingPage({ params }: { params: Promise<{ attemptId: string }> }) {
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
  if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return notFound()
  const review = await quizGradingRepository.getForMentor(user.id, attemptId)
  if (!review) return notFound()
  const pending = review.answers
    .map((answer, index) => ({ answer, number: index + 1 }))
    .filter(({ answer }) => answer.gradingStatus === 'pending')

  return (
    <div className="mx-auto w-full max-w-5xl py-6 max-md:pt-0 sm:px-6 lg:px-8">
      <MobilePageBar backHref="/learn/studio/assignments" title="Grade quiz answers" />
      <Link href="/learn/studio/assignments" className="inline-flex items-center gap-2 text-sm font-bold text-ocean-700 underline-offset-2 transition-colors hover:text-navy-950 hover:underline max-md:hidden">
        <ArrowLeft className="size-4" aria-hidden="true" /> Grading
      </Link>

      <section className="mt-5 overflow-hidden rounded-[1.8rem] bg-navy-950 p-6 text-white shadow-[var(--shadow-card)] sm:p-8 max-md:mt-0 max-md:rounded-2xl max-md:p-5">
        <div className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-teal-200">{review.courseTitle}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight max-md:text-2xl">{review.lessonTitle}</h1>
            <p className="mt-3 text-sm font-bold text-white">{review.learnerName}</p>
            <p className="mt-1 text-sm text-white/68">Quiz attempt {review.attemptNumber} · Submitted {dateLabel(review.submittedAt)} · Pass mark {review.passPercentage}%</p>
          </div>
          <span className={`rounded-full border px-3 py-1.5 text-xs font-bold ${review.status === 'awaiting_grading' ? 'border-amber-300/30 bg-amber-300/10 text-amber-100' : review.passed ? 'border-emerald-300/30 bg-emerald-300/10 text-emerald-100' : 'border-rose-300/30 bg-rose-300/10 text-rose-100'}`}>
            {review.status === 'awaiting_grading' ? 'Awaiting grading' : review.passed ? `Passed · ${review.percentage}%` : `Not passed · ${review.percentage}%`}
          </span>
        </div>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-[1.15fr_0.85fr] lg:items-start">
        <div className="space-y-4">
          {review.answers.map((answer, index) => <AnswerSummary key={answer.id} answer={answer} number={index + 1} />)}
        </div>
        <aside className="rounded-[1.4rem] border border-mist-200 bg-white p-5 shadow-[var(--shadow-card)] max-md:order-first sm:p-6 lg:sticky lg:top-24">
          {review.status === 'awaiting_grading' && pending.length ? (
            <>
              <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.14em] text-teal-700"><PenLine className="size-4" aria-hidden="true" /> Written answers</p>
              <h2 className="mt-1 text-xl font-bold text-navy-950">Grade {pending.length} {pending.length === 1 ? 'answer' : 'answers'}</h2>
              <p className="mt-2 text-sm leading-6 text-muted">The other questions were marked automatically. Pass/fail, completion and the certificate follow once these are graded.</p>
              <div className="mt-5">
                <QuizGradingControl attemptId={review.id} answers={pending.map(({ answer, number }) => ({ id: answer.id, maxPoints: answer.maxPoints, number, prompt: answer.prompt, textResponse: answer.textResponse }))} />
              </div>
            </>
          ) : (
            <>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-teal-700">Result</p>
              <h2 className="mt-1 text-xl font-bold text-navy-950">{review.passed ? 'Passed' : 'Not passed'}</h2>
              <p className="mt-3 text-2xl font-bold text-navy-950">
                {review.scorePoints !== null && review.maxPoints !== null ? `${marksLabel(review.scorePoints)}/${marksLabel(review.maxPoints)} ` : ''}
                <span className="text-base text-muted">· {review.percentage}%</span>
              </p>
              {review.gradedAt ? <p className="mt-3 text-xs font-semibold text-muted">Graded {dateLabel(review.gradedAt)}</p> : null}
            </>
          )}
        </aside>
      </div>
    </div>
  )
}

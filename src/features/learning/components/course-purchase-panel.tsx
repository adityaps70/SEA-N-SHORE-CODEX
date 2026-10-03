import Link from 'next/link'
import { AlertTriangle, ArrowRight, CheckCircle2, LockKeyhole } from 'lucide-react'
import { CourseCheckoutButton } from './course-checkout-button'
import { CoursePaymentPendingNotice } from './course-payment-pending-notice'
import { CourseTeamAccessControl } from './course-team-access-control'

/** What a signed-in person sees for a paid course (see course-purchase-state.ts). */
export type CoursePurchaseState =
  | { kind: 'enrolled'; viaTeam: boolean; completed: boolean }
  | { kind: 'team'; reason: string }
  | { kind: 'revoked'; message: string }
  | { kind: 'refund_due'; amountLabel: string; paidLabel: string; reason: string; refundInProgress: boolean }
  | {
      kind: 'buy'
      priceLabel: string
      configured: boolean
      blockedMessage?: string
      pending: { orderId: string; amountLabel: string; startedLabel: string } | null
    }

type Props = {
  course: { id: string; slug: string; title: string }
  state: CoursePurchaseState
}

const CARD = 'rounded-[1.5rem] border border-white/10 bg-white p-4 text-navy-950 shadow-[var(--shadow-card)] sm:p-5'

export function CoursePurchasePanel({ course, state }: Props) {
  if (state.kind === 'enrolled') {
    return (
      <div className={CARD}>
        <div className="flex items-start gap-3">
          <CheckCircle2 aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-emerald-700" />
          <div className="min-w-0">
            <p className="font-bold text-navy-950">{state.viaTeam ? 'You have course team access.' : 'You own this course.'}</p>
            <p className="mt-1 text-sm leading-6 text-muted">
              {state.completed ? 'You finished every lesson. You can review the course at any time.' : 'Pick up where you left off. Your progress is saved to your Sea N Shore learning profile.'}
            </p>
          </div>
        </div>
        <Link
          href={`/learn/courses/${course.slug}/learn`}
          className="mt-4 inline-flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-navy-950 px-5 py-3 text-sm font-bold text-white transition hover:bg-navy-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-600"
        >
          {state.completed ? 'Review course' : 'Continue learning'} <ArrowRight aria-hidden="true" className="size-4" />
        </Link>
        {state.viaTeam ? null : (
          <Link href="/learn/my-learning#purchases" className="mt-3 inline-flex text-xs font-bold text-ocean-700 underline-offset-2 hover:underline">
            View your receipt in My Learning
          </Link>
        )}
      </div>
    )
  }

  if (state.kind === 'team') {
    return (
      <div className={CARD}>
        <CourseTeamAccessControl courseId={course.id} reason={state.reason} />
      </div>
    )
  }

  if (state.kind === 'revoked') {
    return (
      <div className={CARD}>
        <div className="flex items-start gap-3">
          <LockKeyhole aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-rose-700" />
          <p className="text-sm leading-6 text-navy-900">{state.message}</p>
        </div>
      </div>
    )
  }

  if (state.kind === 'refund_due') {
    return (
      <div className={CARD} role="region" aria-label="Refund on its way">
        <div className="flex items-start gap-3">
          <AlertTriangle aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-700" />
          <div className="min-w-0">
            <p className="font-bold text-navy-950">Payment received, course not unlocked</p>
            <p className="mt-1 text-sm leading-6 text-navy-700">
              We received {state.amountLabel} on {state.paidLabel} but could not unlock the course. {state.reason}{' '}
              {state.refundInProgress
                ? 'Your refund has been started and goes back to your original payment method (usually 5–7 working days).'
                : 'The Sea N Shore team will refund the full amount to your original payment method.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`${CARD} space-y-4`}>
      {state.pending ? (
        <CoursePaymentPendingNotice
          courseId={course.id}
          courseSlug={course.slug}
          orderId={state.pending.orderId}
          amountLabel={state.pending.amountLabel}
          startedLabel={state.pending.startedLabel}
        />
      ) : null}
      <CourseCheckoutButton
        courseId={course.id}
        courseSlug={course.slug}
        courseTitle={course.title}
        priceLabel={state.priceLabel}
        paymentsConfigured={state.configured}
        blockedMessage={state.blockedMessage}
      />
    </div>
  )
}

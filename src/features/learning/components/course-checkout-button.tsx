'use client'

import { useRouter } from 'next/navigation'
import { useTransition } from 'react'
import { CHECKOUT_TIMEOUT_SECONDS } from '@/features/payments/event-payment-rules'
import { GatewayCheckoutButton } from '@/features/payments/components/gateway-checkout-button'
import { confirmCoursePaymentAction, startCourseCheckoutAction } from '../course-payment-actions'
import { COURSE_PAYMENTS_NOT_CONFIGURED_HELP, COURSE_PAYMENTS_NOT_CONFIGURED_LABEL } from '../course-payment-rules'

type Props = {
  courseId: string
  courseSlug: string
  courseTitle: string
  /** e.g. "₹4,999" — what the learner pays. */
  priceLabel: string
  paymentsConfigured: boolean
  /** Why the course cannot be bought right now (e.g. its currency is not accepted yet). */
  blockedMessage?: string
}

/** "Buy course — ₹X": gateway checkout, then straight into the course player once the server confirms. */
export function CourseCheckoutButton({ courseId, courseSlug, courseTitle, priceLabel, paymentsConfigured, blockedMessage }: Props) {
  const router = useRouter()
  const [, startTransition] = useTransition()

  return (
    <GatewayCheckoutButton
      actionLabel={`Buy course — ${priceLabel}`}
      description={courseTitle}
      hint="Secure payment by card, UPI or net banking. The course unlocks as soon as the payment succeeds."
      configured={paymentsConfigured}
      notConfiguredLabel={COURSE_PAYMENTS_NOT_CONFIGURED_LABEL}
      notConfiguredHelp={COURSE_PAYMENTS_NOT_CONFIGURED_HELP}
      disabled={Boolean(blockedMessage)}
      unavailableLabel={blockedMessage ? 'Not on sale yet' : undefined}
      unavailableHelp={blockedMessage}
      successFallback="Payment received. You're enrolled."
      timeoutSeconds={CHECKOUT_TIMEOUT_SECONDS}
      start={({ phone }) => startCourseCheckoutAction(courseId, phone ? { phone } : {})}
      confirm={({ orderId, proof }) => confirmCoursePaymentAction({ courseId, orderId, proof })}
      onSettled={(result) => {
        startTransition(() => {
          if (result?.ok) router.push(`/learn/courses/${courseSlug}/learn`)
          else router.refresh()
        })
      }}
    />
  )
}

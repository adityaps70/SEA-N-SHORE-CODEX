import type { DatabaseQueryClient } from '@/lib/db/client'
import { courseViewerResult } from '@/features/learning/course-payment-messages'
import { coursePaymentRepository } from '@/features/learning/course-payment-repository'
import { coursePaymentService } from '@/features/learning/course-payment-runtime'
import type { GatewayOrderEvent, OrderHandlerResult, ViewerConfirmResult } from './order-handler-types'

/**
 * Paid courses ("crs_" gateway orders); order-handlers.ts routes them here. The work
 * lives in features/learning (course-payment-service.ts / course-payment-repository.ts).
 *
 * confirmCoursePaymentOrder runs inside the Cashfree webhook transaction `tx` (already
 * signature-verified and de-duplicated). It is idempotent: a paid order enrolls the
 * learner (source 'purchase') and records the seller's earning once; a refund ends
 * the access and reverses the earning once.
 */
export async function confirmCoursePaymentOrder(tx: DatabaseQueryClient, event: GatewayOrderEvent): Promise<OrderHandlerResult> {
  return coursePaymentService.applyGatewayEvent(tx, event)
}

/** The signed-in buyer returned from a course checkout (/payments/return?order=crs_…). */
export async function confirmCourseCheckoutForViewer(input: { profileId: string; providerOrderId: string }): Promise<ViewerConfirmResult> {
  const outcome = await coursePaymentService.confirmByProviderOrderId(input)
  const slug = outcome ? await coursePaymentRepository.getCourseSlug(outcome.order.courseId) : null
  return courseViewerResult(outcome, slug)
}

import { getGatewayByName, getPaymentGateway } from '@/features/payments/provider'
import { createCoursePaymentService } from './course-payment-service'

/** The course payment service wired to the configured gateways. Server only. */
export const coursePaymentService = createCoursePaymentService({
  getGateway: getPaymentGateway,
  getGatewayByName,
})

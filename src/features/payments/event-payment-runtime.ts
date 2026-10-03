import { createEventPaymentService } from './event-payment-service'
import { getGatewayByName, getPaymentGateway } from './provider'

/** The event payment service wired to the configured gateways. Server only. */
export const eventPaymentService = createEventPaymentService({
  getGateway: getPaymentGateway,
  getGatewayByName,
})

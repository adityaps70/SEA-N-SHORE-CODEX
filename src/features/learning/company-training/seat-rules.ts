import { formatMoney } from '@/features/payments/currency'
import type { PaymentCurrency } from '@/features/payments/types'
import { addCalendarMonths } from '@/lib/calendar-months'

/**
 * Company training (round D, part 3): the rules for seat packs, shared by the server and the company pages. Safe to
 * import from client components.
 *
 * A company buys N seats of one course at the course's price per seat (its sale price when it has one), less a volume
 * discount: 10+ seats 10 % off, 50+ seats 20 % off. Unassigned seats can be assigned for 12 months from purchase and
 * refunded within 30 days of it. An assigned seat can move to another crew member while the first learner is at 10 %
 * progress or less.
 */

export const SEAT_PACK_MIN = 1
export const SEAT_PACK_MAX = 1000
export const SEAT_VALIDITY_MONTHS = 12
export const SEAT_REFUND_DAYS = 30
export const SEAT_REASSIGN_MAX_PROGRESS = 10
export const VOLUME_DISCOUNT_TIERS = [
  { minSeats: 50, basisPoints: 2000 },
  { minSeats: 10, basisPoints: 1000 },
] as const

export type VolumeDiscountBasisPoints = 0 | 1000 | 2000

export function volumeDiscountFor(quantity: number): VolumeDiscountBasisPoints {
  for (const tier of VOLUME_DISCOUNT_TIERS) if (quantity >= tier.minSeats) return tier.basisPoints
  return 0
}

export function isSeatQuantity(value: number) {
  return Number.isInteger(value) && value >= SEAT_PACK_MIN && value <= SEAT_PACK_MAX
}

export type SeatPackQuote = {
  quantity: number
  currency: PaymentCurrency
  /** The course plan's list price per seat. */
  listUnitMinor: number
  /** What one seat costs before the volume discount (the sale price when the plan has one). */
  baseUnitMinor: number
  volumeDiscountBasisPoints: VolumeDiscountBasisPoints
  /** What one seat costs after the volume discount. */
  unitMinor: number
  /** The list price of the whole pack, and its price when that is lower (the order's discount price). */
  listTotalMinor: number
  discountTotalMinor: number | null
  totalMinor: number
}

/**
 * The price of a pack. The discount is taken off the price per seat (rounded to the nearest minor unit), so every seat
 * in the pack costs the same and a refund of k seats is exactly k × the price per seat.
 */
export function seatPackQuote(input: { quantity: number; listUnitMinor: number; baseUnitMinor: number; currency: PaymentCurrency }): SeatPackQuote {
  if (!isSeatQuantity(input.quantity)) throw new RangeError('seat_quantity_invalid')
  const basisPoints = volumeDiscountFor(input.quantity)
  const unitMinor = input.baseUnitMinor - Math.round((input.baseUnitMinor * basisPoints) / 10_000)
  const listTotalMinor = input.listUnitMinor * input.quantity
  const totalMinor = unitMinor * input.quantity
  return {
    quantity: input.quantity,
    currency: input.currency,
    listUnitMinor: input.listUnitMinor,
    baseUnitMinor: input.baseUnitMinor,
    volumeDiscountBasisPoints: basisPoints,
    unitMinor,
    listTotalMinor,
    discountTotalMinor: totalMinor < listTotalMinor ? totalMinor : null,
    totalMinor,
  }
}

export function volumeDiscountLabel(basisPoints: number) {
  return basisPoints > 0 ? `${basisPoints / 100}% volume discount` : null
}

/** One line for the GST invoice, e.g. "…: online course access for company crew, 12 seats at ₹4,050 each (10% volume discount)". */
export function seatPackInvoiceDescription(input: { courseTitle: string; planName: string | null; quantity: number; unitMinor: number; basisPoints: number; currency: string }) {
  const seats = `${input.quantity} ${input.quantity === 1 ? 'seat' : 'seats'}`
  const each = formatMoney(input.unitMinor, input.currency)
  const discount = input.basisPoints > 0 ? ` (${input.basisPoints / 100}% volume discount)` : ''
  const course = `${input.courseTitle}${input.planName ? ` (${input.planName})` : ''}`
  return `${course}: online course access for company crew, ${seats} at ${each} each${discount}`.slice(0, 300)
}

/** Same day of the month, clamped to the month's last day (29 Feb + 12 months = 28 Feb), as the database stores it. */
export function addMonths(at: Date, months: number) {
  return addCalendarMonths(at, months)
}

/** The last moment an unassigned seat of a pack bought at `paidAt` can be given to someone. */
export function seatValidUntil(paidAt: Date) {
  return addMonths(paidAt, SEAT_VALIDITY_MONTHS)
}

/** The last moment unassigned seats of a pack bought at `paidAt` can be refunded. */
export function seatRefundableUntil(paidAt: Date) {
  return new Date(paidAt.getTime() + SEAT_REFUND_DAYS * 24 * 60 * 60 * 1000)
}

export type SeatRefusal =
  | 'company_not_found'
  | 'company_not_verified'
  | 'company_training_not_allowed'
  | 'seat_quantity_invalid'
  | 'seat_pack_currency_unsupported'
  | 'seat_pack_gstin_required'
  | 'seat_pack_not_found'
  | 'seat_refund_window_closed'
  | 'seat_refund_none_available'
  | 'seat_refund_too_many'
  | 'seat_refund_already_used'
  | 'seat_refund_in_progress'
  | 'seat_none_available'
  | 'seat_not_found'
  | 'seat_learner_not_in_crew'
  | 'seat_learner_already_enrolled'
  | 'seat_learner_is_course_team'
  | 'seat_reassign_progress_too_high'
  | 'seat_reassign_sharing_stopped'
  | 'seat_reassign_same_learner'
  | 'seat_batch_required'

export class SeatError extends Error {
  constructor(readonly code: SeatRefusal) {
    super(code)
    this.name = 'SeatError'
  }
}

export function seatRefusalMessage(code: SeatRefusal) {
  switch (code) {
    case 'company_not_found':
      return 'We could not find this organization.'
    case 'company_not_verified':
      return 'Company training opens once Sea N Shore has verified this organization.'
    case 'company_training_not_allowed':
      return 'Only the owner, administrators and learning managers of this organization can manage its training.'
    case 'seat_quantity_invalid':
      return `Choose between ${SEAT_PACK_MIN} and ${SEAT_PACK_MAX} seats.`
    case 'seat_pack_currency_unsupported':
      return 'Seat packs are sold in rupees with a GST invoice. This course is not priced in rupees.'
    case 'seat_pack_gstin_required':
      return 'Seat packs come with a business GST invoice. Enter the company name and GSTIN.'
    case 'seat_pack_not_found':
      return 'We could not find this seat pack. Refresh the page and try again.'
    case 'seat_refund_window_closed':
      return `Unassigned seats can be refunded within ${SEAT_REFUND_DAYS} days of the purchase. This pack is older than that.`
    case 'seat_refund_none_available':
      return 'This pack has no unassigned seats to refund.'
    case 'seat_refund_too_many':
      return 'You chose more seats than this pack has unassigned.'
    case 'seat_refund_already_used':
      return 'Seats from this pack were already refunded. A pack can be refunded once.'
    case 'seat_refund_in_progress':
      return 'A refund for this pack is already being processed. Refresh the page in a minute to see the result.'
    case 'seat_none_available':
      return 'There are no unassigned seats of this course left. Buy more seats to assign it.'
    case 'seat_not_found':
      return 'We could not find this seat. Refresh the page and try again.'
    case 'seat_learner_not_in_crew':
      return 'This person is not in your training crew. They need to accept your invitation first.'
    case 'seat_learner_already_enrolled':
      return 'This person already has access to the course, so a seat is not needed.'
    case 'seat_learner_is_course_team':
      return 'This person is on the course team and already has access.'
    case 'seat_reassign_progress_too_high':
      return `This seat can no longer move: the learner is past ${SEAT_REASSIGN_MAX_PROGRESS}% of the course.`
    case 'seat_reassign_sharing_stopped':
      return 'This learner has stopped sharing their progress with you, so the seat can no longer move.'
    case 'seat_reassign_same_learner':
      return 'Choose a different crew member for this seat.'
    case 'seat_batch_required':
      return 'This course runs in batches. Choose a batch for the learner.'
  }
}

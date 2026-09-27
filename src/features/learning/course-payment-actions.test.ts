import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  userCan: vi.fn(),
  canAccessPlatformAdmin: vi.fn(),
  revalidatePath: vi.fn(),
  loadCheckoutCustomer: vi.fn(),
  service: {
    startCheckout: vi.fn(),
    confirmCheckout: vi.fn(),
    refundOrder: vi.fn(),
  },
  repository: {
    getOrderForManager: vi.fn(),
    getOrderById: vi.fn(),
    getCourseSlug: vi.fn(),
    isCourseManager: vi.fn(),
  },
  grantTeamAccess: vi.fn(),
}))

vi.mock('next/cache', () => ({ revalidatePath: mocks.revalidatePath }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/access/server', () => ({ userCan: mocks.userCan }))
vi.mock('@/features/admin/access', () => ({ canAccessPlatformAdmin: mocks.canAccessPlatformAdmin }))
vi.mock('@/lib/db/client', () => ({ query: vi.fn(), withTransaction: vi.fn() }))
vi.mock('./course-payment-runtime', () => ({ coursePaymentService: mocks.service }))
vi.mock('@/features/payments/customer-contact', async () => {
  const actual = await vi.importActual<typeof import('@/features/payments/customer-contact')>('@/features/payments/customer-contact')
  return { ...actual, loadCheckoutCustomer: mocks.loadCheckoutCustomer }
})
vi.mock('./course-payment-repository', () => {
  class CoursePurchaseError extends Error {
    constructor(readonly code: string) {
      super(code)
    }
  }
  return { CoursePurchaseError, coursePaymentRepository: mocks.repository }
})
vi.mock('./enrollment-repository', () => ({ enrollmentRepository: { grantTeamAccess: mocks.grantTeamAccess, enrollFreeCourse: vi.fn() } }))

import { CustomerPhoneRequiredError, PaymentsNotConfiguredError, RefundFailedError } from '@/features/payments/event-payment-service'
import { confirmCoursePaymentAction, refundCoursePaymentAction, startCourseCheckoutAction } from './course-payment-actions'
import { CoursePurchaseError, type CoursePaymentOrder } from './course-payment-repository'
import { openCourseAsTeamMember } from './enrollment-actions'

const userId = '11111111-1111-4111-8111-111111111111'
const courseId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'
const customer = { id: userId, email: 'officer@example.com', phone: '+919876543210', name: 'Capt. Rao' }
const order = {
  id: orderId,
  courseId,
  courseTitle: 'SIRE 2.0 Masterclass',
  amountMinor: 400000,
  currency: 'INR',
  status: 'paid',
  refundDueReason: null,
} as unknown as CoursePaymentOrder

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: userId, email: 'officer@example.com' })
  mocks.userCan.mockResolvedValue(true)
  mocks.canAccessPlatformAdmin.mockResolvedValue(false)
  mocks.loadCheckoutCustomer.mockResolvedValue({ customer, invalidPhone: false })
  mocks.repository.getCourseSlug.mockResolvedValue('sire-2-masterclass')
  mocks.service.startCheckout.mockResolvedValue({
    orderId,
    client: { provider: 'cashfree', providerOrderId: 'crs_x', paymentSessionId: 'session_1', mode: 'sandbox' },
    amountMinor: 400000,
    currency: 'INR',
    courseTitle: 'SIRE 2.0 Masterclass',
  })
})

describe('startCourseCheckoutAction', () => {
  it('starts checkout for the signed-in learner only (the course id is the only input that matters)', async () => {
    const result = await startCourseCheckoutAction(courseId)
    expect(mocks.userCan).toHaveBeenCalledWith(userId, 'course.enroll')
    expect(mocks.service.startCheckout).toHaveBeenCalledWith({ profileId: userId, courseId, customer })
    expect(result).toEqual({
      ok: true,
      checkout: { orderId, client: expect.objectContaining({ provider: 'cashfree' }), prefill: { email: customer.email, phone: customer.phone, name: customer.name } },
    })
  })

  it('refuses accounts that cannot enroll and platform admins (they have access without buying)', async () => {
    mocks.userCan.mockResolvedValueOnce(false)
    await expect(startCourseCheckoutAction(courseId)).resolves.toEqual({ ok: false, error: 'Your account cannot enroll in courses right now.' })
    mocks.canAccessPlatformAdmin.mockResolvedValueOnce(true)
    await expect(startCourseCheckoutAction(courseId)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/already have access to this course without buying/) })
    expect(mocks.service.startCheckout).not.toHaveBeenCalled()
  })

  it('asks for a mobile number when the gateway needs one, and rejects an unusable number', async () => {
    mocks.service.startCheckout.mockRejectedValueOnce(new CustomerPhoneRequiredError())
    await expect(startCourseCheckoutAction(courseId)).resolves.toMatchObject({ ok: false, needsPhone: true })
    mocks.loadCheckoutCustomer.mockResolvedValueOnce({ customer, invalidPhone: true })
    await expect(startCourseCheckoutAction(courseId, { phone: '12' })).resolves.toMatchObject({ ok: false, needsPhone: true, error: expect.stringMatching(/valid mobile number/) })
  })

  it('explains purchase blockers and payments that are not set up in plain words', async () => {
    mocks.service.startCheckout.mockRejectedValueOnce(new CoursePurchaseError('already_enrolled'))
    await expect(startCourseCheckoutAction(courseId)).resolves.toEqual({ ok: false, error: 'You already have this course. Open it from My Learning.' })
    mocks.service.startCheckout.mockRejectedValueOnce(new PaymentsNotConfiguredError())
    await expect(startCourseCheckoutAction(courseId)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Payments aren't switched on/) })
    await expect(startCourseCheckoutAction('not-a-uuid')).resolves.toMatchObject({ ok: false })
  })
})

describe('confirmCoursePaymentAction', () => {
  it('confirms through the server-side service and says the learner is enrolled', async () => {
    mocks.service.confirmCheckout.mockResolvedValueOnce({ state: 'enrolled', order })
    const result = await confirmCoursePaymentAction({ courseId, orderId, proof: null })
    expect(mocks.service.confirmCheckout).toHaveBeenCalledWith({ profileId: userId, orderId, proof: undefined })
    expect(result).toEqual({ ok: true, state: 'paid', message: "Payment of ₹4,000 received. You're enrolled — opening the course…" })
    expect(mocks.revalidatePath).toHaveBeenCalledWith('/learn/courses/sire-2-masterclass')
  })

  it('never reports paid while the bank is still processing', async () => {
    mocks.service.confirmCheckout.mockResolvedValueOnce({ state: 'processing', order })
    await expect(confirmCoursePaymentAction({ courseId, orderId })).resolves.toMatchObject({ ok: false, state: 'processing', error: expect.stringMatching(/hasn't confirmed the payment of ₹4,000 yet/) })
  })

  it('turns unexpected errors into a calm message', async () => {
    mocks.service.confirmCheckout.mockRejectedValueOnce(new Error('boom'))
    await expect(confirmCoursePaymentAction({ courseId, orderId })).resolves.toMatchObject({ ok: false, state: 'error', error: expect.stringMatching(/unlocks automatically/) })
    await expect(confirmCoursePaymentAction({ courseId: 'x', orderId })).resolves.toMatchObject({ ok: false, state: 'error' })
  })
})

describe('refundCoursePaymentAction', () => {
  it('lets the course owner or organization learning manager refund a purchase of their course', async () => {
    mocks.repository.getOrderForManager.mockResolvedValueOnce(order)
    mocks.service.refundOrder.mockResolvedValueOnce({ state: 'refunded', order: { ...order, status: 'refunded' } })
    const result = await refundCoursePaymentAction(orderId)
    expect(mocks.repository.getOrderForManager).toHaveBeenCalledWith(orderId, userId)
    expect(mocks.service.refundOrder).toHaveBeenCalledWith({ orderId, actor: { type: 'organizer', profileId: userId }, reason: 'course_team_refund' })
    expect(result).toEqual({ ok: true, message: "Refunded ₹4,000. The learner's access has ended and the money is on its way back to their original payment method." })
  })

  it('lets platform admins refund any purchase', async () => {
    mocks.repository.getOrderForManager.mockResolvedValueOnce(null)
    mocks.canAccessPlatformAdmin.mockResolvedValueOnce(true)
    mocks.repository.getOrderById.mockResolvedValueOnce(order)
    mocks.service.refundOrder.mockResolvedValueOnce({ state: 'refund_pending', order })
    await expect(refundCoursePaymentAction(orderId)).resolves.toMatchObject({ ok: true, message: expect.stringMatching(/Refund of ₹4,000 started/) })
    expect(mocks.service.refundOrder).toHaveBeenCalledWith(expect.objectContaining({ actor: { type: 'admin', profileId: userId }, reason: 'admin_refund' }))
  })

  it('refuses everyone else without touching the gateway', async () => {
    mocks.repository.getOrderForManager.mockResolvedValueOnce(null)
    await expect(refundCoursePaymentAction(orderId)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/Only the course owner/) })
    expect(mocks.repository.getOrderById).not.toHaveBeenCalled()
    expect(mocks.service.refundOrder).not.toHaveBeenCalled()
  })

  it('explains a refund already in progress and a gateway refusal', async () => {
    mocks.repository.getOrderForManager.mockResolvedValue(order)
    mocks.service.refundOrder.mockRejectedValueOnce(new CoursePurchaseError('refund_in_progress'))
    await expect(refundCoursePaymentAction(orderId)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/already being processed/) })
    mocks.service.refundOrder.mockRejectedValueOnce(new RefundFailedError('Insufficient balance.'))
    await expect(refundCoursePaymentAction(orderId)).resolves.toEqual({ ok: false, error: 'The payment provider did not accept the refund: Insufficient balance. Nothing was refunded. Try again later or contact the Sea N Shore team.' })
  })
})

describe('openCourseAsTeamMember', () => {
  it('opens the course for its team without buying', async () => {
    mocks.repository.isCourseManager.mockResolvedValueOnce(true)
    mocks.grantTeamAccess.mockResolvedValueOnce({ enrollmentId: 'e1', status: 'active' })
    await expect(openCourseAsTeamMember(courseId)).resolves.toEqual({ ok: true, href: '/learn/courses/sire-2-masterclass/learn' })
    expect(mocks.grantTeamAccess).toHaveBeenCalledWith(userId, courseId)
  })

  it('refuses learners who are not on the course team', async () => {
    mocks.repository.isCourseManager.mockResolvedValueOnce(false)
    mocks.canAccessPlatformAdmin.mockResolvedValueOnce(false)
    await expect(openCourseAsTeamMember(courseId)).resolves.toMatchObject({ ok: false, error: expect.stringMatching(/without buying it/) })
    expect(mocks.grantTeamAccess).not.toHaveBeenCalled()
  })
})

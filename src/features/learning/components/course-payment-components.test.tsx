import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  startCourseCheckoutAction: vi.fn(),
  confirmCoursePaymentAction: vi.fn(),
  refundCoursePaymentAction: vi.fn(),
  openCourseAsTeamMember: vi.fn(),
  cashfreeCheckout: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('../course-payment-actions', () => ({
  startCourseCheckoutAction: mocks.startCourseCheckoutAction,
  confirmCoursePaymentAction: mocks.confirmCoursePaymentAction,
  refundCoursePaymentAction: mocks.refundCoursePaymentAction,
}))
vi.mock('../enrollment-actions', () => ({ openCourseAsTeamMember: mocks.openCourseAsTeamMember }))

import type { LearnerCoursePurchase } from '../course-payment-repository'
import { CourseCheckoutButton } from './course-checkout-button'
import { CoursePaymentPendingNotice } from './course-payment-pending-notice'
import { CoursePurchasesList } from './course-purchases-list'
import { CourseRefundButton } from './course-refund-button'
import { CourseTeamAccessControl } from './course-team-access-control'

const courseId = '22222222-2222-4222-8222-222222222222'
const orderId = '33333333-3333-4333-8333-333333333333'

afterEach(() => {
  cleanup()
  delete (window as unknown as { Cashfree?: unknown }).Cashfree
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CourseCheckoutButton', () => {
  it('shows a disabled "Purchases open soon" state while payments are not set up', () => {
    render(<CourseCheckoutButton courseId={courseId} courseSlug="sire-2" courseTitle="SIRE 2.0" priceLabel="₹4,000" paymentsConfigured={false} />)
    expect(screen.getByRole('button', { name: 'Purchases open soon' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Buy course/ })).not.toBeInTheDocument()
  })

  it('explains why a course cannot be bought (e.g. its currency)', () => {
    render(<CourseCheckoutButton courseId={courseId} courseSlug="sire-2" courseTitle="SIRE 2.0" priceLabel="$50" paymentsConfigured blockedMessage="This course is priced in a currency Sea N Shore can't accept yet." />)
    expect(screen.getByRole('button', { name: 'Not on sale yet' })).toBeDisabled()
    expect(screen.getByText(/currency Sea N Shore can't accept yet/)).toBeInTheDocument()
  })

  it('pays through Cashfree, confirms on the server and opens the course player', async () => {
    const cashfree = { checkout: mocks.cashfreeCheckout }
    ;(window as unknown as { Cashfree: unknown }).Cashfree = () => cashfree
    mocks.cashfreeCheckout.mockResolvedValue({ paymentDetails: { paymentMessage: 'Payment finished.' } })
    mocks.startCourseCheckoutAction.mockResolvedValue({
      ok: true,
      checkout: { orderId, client: { provider: 'cashfree', providerOrderId: 'crs_x', paymentSessionId: 'session_1', mode: 'sandbox' }, prefill: { email: null, phone: '+919876543210', name: null } },
    })
    mocks.confirmCoursePaymentAction.mockResolvedValue({ ok: true, state: 'paid', message: "Payment of ₹4,000 received. You're enrolled — opening the course…" })

    render(<CourseCheckoutButton courseId={courseId} courseSlug="sire-2" courseTitle="SIRE 2.0" priceLabel="₹4,000" paymentsConfigured />)
    fireEvent.click(screen.getByRole('button', { name: 'Buy course — ₹4,000' }))

    expect(await screen.findByText("Payment of ₹4,000 received. You're enrolled — opening the course…")).toBeInTheDocument()
    expect(mocks.startCourseCheckoutAction).toHaveBeenCalledWith(courseId, {})
    expect(mocks.confirmCoursePaymentAction).toHaveBeenCalledWith({ courseId, orderId, proof: null })
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/learn/courses/sire-2/learn'))
  })

  it('shows the server’s reason and stays on the page when the course cannot be bought', async () => {
    mocks.startCourseCheckoutAction.mockResolvedValue({ ok: false, error: 'You already have this course. Open it from My Learning.' })
    render(<CourseCheckoutButton courseId={courseId} courseSlug="sire-2" courseTitle="SIRE 2.0" priceLabel="₹4,000" paymentsConfigured />)
    fireEvent.click(screen.getByRole('button', { name: 'Buy course — ₹4,000' }))
    expect(await screen.findByText('You already have this course. Open it from My Learning.')).toBeInTheDocument()
    expect(mocks.push).not.toHaveBeenCalled()
  })
})

describe('CoursePaymentPendingNotice', () => {
  function renderNotice() {
    return render(<CoursePaymentPendingNotice courseId={courseId} courseSlug="sire-2" orderId={orderId} amountLabel="₹4,000" startedLabel="1 Jan 2030, 10:05 am" />)
  }

  it('asks the server and opens the course once the payment is confirmed', async () => {
    mocks.confirmCoursePaymentAction.mockResolvedValue({ ok: true, state: 'paid', message: 'Payment of ₹4,000 received.' })
    renderNotice()
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }))
    expect(screen.getByRole('button', { name: 'Checking your payment…' })).toBeDisabled()
    expect(await screen.findByText('Payment of ₹4,000 received.')).toBeInTheDocument()
    expect(mocks.confirmCoursePaymentAction).toHaveBeenCalledWith({ courseId, orderId, proof: null })
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/learn/courses/sire-2/learn'))
  })

  it('says the bank is still processing without refreshing away', async () => {
    mocks.confirmCoursePaymentAction.mockResolvedValue({ ok: false, state: 'processing', error: "Your bank hasn't confirmed the payment of ₹4,000 yet." })
    renderNotice()
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }))
    expect(await screen.findByText("Your bank hasn't confirmed the payment of ₹4,000 yet.")).toBeInTheDocument()
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('handles a lost connection with a clear message', async () => {
    mocks.confirmCoursePaymentAction.mockRejectedValue(new Error('offline'))
    renderNotice()
    fireEvent.click(screen.getByRole('button', { name: 'Check payment status' }))
    expect(await screen.findByText(/Check your connection and try again/)).toBeInTheDocument()
  })
})

describe('CourseRefundButton', () => {
  function renderButton() {
    return render(<CourseRefundButton orderId={orderId} amountLabel="₹4,000" learnerName="Capt. Rao" courseTitle="SIRE 2.0" hasAccess />)
  }

  it('asks for inline confirmation, and Escape or Keep purchase cancels without refunding', () => {
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Refund ₹4,000' }))
    const group = screen.getByRole('group', { name: 'Refund ₹4,000 to Capt. Rao?' })
    expect(within(group).getByText(/Their access to SIRE 2.0 ends straight away/)).toBeInTheDocument()
    expect(within(group).getByRole('button', { name: 'Yes, refund ₹4,000' })).toHaveFocus()
    fireEvent.keyDown(group, { key: 'Escape' })
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Refund ₹4,000' }))
    fireEvent.click(screen.getByRole('button', { name: 'Keep purchase' }))
    expect(mocks.refundCoursePaymentAction).not.toHaveBeenCalled()
  })

  it('refunds once even when clicked twice, then shows the result', async () => {
    let resolve: (value: unknown) => void = () => undefined
    mocks.refundCoursePaymentAction.mockImplementation(() => new Promise((done) => { resolve = done }))
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Refund ₹4,000' }))
    const confirm = screen.getByRole('button', { name: 'Yes, refund ₹4,000' })
    fireEvent.click(confirm)
    fireEvent.click(confirm)
    expect(screen.getByRole('button', { name: 'Refunding…' })).toBeDisabled()
    resolve({ ok: true, message: "Refunded ₹4,000. The learner's access has ended." })
    expect(await screen.findByText("Refunded ₹4,000. The learner's access has ended.")).toBeInTheDocument()
    expect(mocks.refundCoursePaymentAction).toHaveBeenCalledTimes(1)
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('keeps the confirmation open with the reason when the refund fails', async () => {
    mocks.refundCoursePaymentAction.mockResolvedValue({ ok: false, error: 'The payment provider did not accept the refund. Nothing was refunded.' })
    renderButton()
    fireEvent.click(screen.getByRole('button', { name: 'Refund ₹4,000' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, refund ₹4,000' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was refunded.')
    expect(screen.getByRole('button', { name: 'Yes, refund ₹4,000' })).toBeEnabled()
  })
})

describe('CourseTeamAccessControl', () => {
  it('opens the course for the team', async () => {
    mocks.openCourseAsTeamMember.mockResolvedValue({ ok: true, href: '/learn/courses/sire-2/learn' })
    render(<CourseTeamAccessControl courseId={courseId} reason="You manage this course" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open course' }))
    await waitFor(() => expect(mocks.push).toHaveBeenCalledWith('/learn/courses/sire-2/learn'))
  })

  it('shows why the course could not be opened', async () => {
    mocks.openCourseAsTeamMember.mockResolvedValue({ ok: false, error: 'This course is not published right now, so it cannot be opened here.' })
    render(<CourseTeamAccessControl courseId={courseId} reason="Sea N Shore team access" />)
    fireEvent.click(screen.getByRole('button', { name: 'Open course' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('This course is not published right now')
    expect(screen.getByRole('button', { name: 'Open course' })).toBeEnabled()
  })
})

describe('CoursePurchasesList', () => {
  const purchase: LearnerCoursePurchase = {
    id: orderId,
    courseId,
    profileId: 'p1',
    courseTitle: 'SIRE 2.0 Masterclass',
    listPriceMinor: 500000,
    discountPriceMinor: 400000,
    amountMinor: 400000,
    currency: 'INR',
    provider: 'cashfree',
    providerOrderId: 'crs_33333333333343338333333333333333',
    providerPaymentId: 'cf_pay_1',
    providerSessionId: null,
    status: 'paid',
    enrollmentId: 'e1',
    enrollmentConfirmedAt: '2030-01-01T10:00:00.000Z',
    refundDueReason: null,
    failureReason: null,
    paidAt: '2030-01-01T10:00:00.000Z',
    refundedAt: null,
    refundStatus: null,
    refundAttempts: 0,
    providerRefundId: null,
    createdAt: '2030-01-01T09:55:00.000Z',
    courseSlug: 'sire-2-masterclass',
  }

  it('shows each purchase like a receipt: course, amount, date, order id and status', () => {
    render(<CoursePurchasesList purchases={[purchase, { ...purchase, id: 'o2', status: 'refunded', refundStatus: 'processed', refundedAt: '2030-01-03T10:00:00.000Z', courseTitle: 'Tanker Cargo Ops' }]} />)
    const items = screen.getAllByRole('listitem')
    expect(within(items[0]!).getByRole('link', { name: 'SIRE 2.0 Masterclass' })).toHaveAttribute('href', '/learn/courses/sire-2-masterclass/learn')
    expect(within(items[0]!).getByText('₹4,000')).toBeInTheDocument()
    expect(within(items[0]!).getByText('₹5,000')).toHaveClass('line-through')
    expect(within(items[0]!).getByText('1 Jan 2030')).toBeInTheDocument()
    expect(within(items[0]!).getByText('crs_33333333333343338333333333333333')).toBeInTheDocument()
    expect(within(items[0]!).getByText('Paid')).toBeInTheDocument()
    expect(within(items[1]!).getByText('Refunded')).toBeInTheDocument()
    expect(within(items[1]!).getByText(/Refunded ₹4,000 on 3 Jan 2030 to your original payment method. Course access has ended./)).toBeInTheDocument()
    expect(within(items[1]!).queryByRole('link')).not.toBeInTheDocument()
  })

  it('has a clear empty state', () => {
    render(<CoursePurchasesList purchases={[]} />)
    expect(screen.getByText(/You haven't bought any courses yet/)).toBeInTheDocument()
  })
})

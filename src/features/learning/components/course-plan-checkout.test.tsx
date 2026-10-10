import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  refresh: vi.fn(),
  previewCoursePriceAction: vi.fn(),
  startCourseCheckoutAction: vi.fn(),
  confirmCoursePaymentAction: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('../course-payment-actions', () => ({
  previewCoursePriceAction: mocks.previewCoursePriceAction,
  startCourseCheckoutAction: mocks.startCourseCheckoutAction,
  confirmCoursePaymentAction: mocks.confirmCoursePaymentAction,
}))

import { CoursePlanCheckout, type CoursePlanOffer } from './course-plan-checkout'

const courseId = '22222222-2222-4222-8222-222222222222'
const lifetimePlanId = '44444444-4444-4444-8444-444444444444'
const sixMonthPlanId = '55555555-5555-4555-8555-555555555555'

const plans: CoursePlanOffer[] = [
  { id: lifetimePlanId, name: 'Lifetime', priceLabel: '₹4,000', listLabel: '₹5,000', accessLabel: 'Lifetime access', currency: 'INR' },
  { id: sixMonthPlanId, name: 'Six months', priceLabel: '₹2,000', listLabel: null, accessLabel: '6 months of access', currency: 'INR' },
]

function quote(overrides: Record<string, unknown> = {}) {
  return {
    ok: true,
    planName: 'Lifetime',
    accessLabel: 'Lifetime access',
    listLabel: '₹5,000',
    saleLabel: '₹4,000',
    codeLabel: 'FIXTURE20',
    discountLabel: '−₹800',
    totalLabel: '₹3,200',
    amountMinor: 320000,
    ...overrides,
  }
}

function renderCheckout(props: Partial<React.ComponentProps<typeof CoursePlanCheckout>> = {}) {
  return render(
    <CoursePlanCheckout courseId={courseId} courseSlug="fixture-course" courseTitle="Fixture Course" plans={plans} paymentsConfigured {...props} />,
  )
}

function openAndApply(code: string) {
  fireEvent.click(screen.getByRole('button', { name: 'Have a promo code?' }))
  fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: code } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.startCourseCheckoutAction.mockResolvedValue({ ok: false, error: 'Fixture checkout stopped.' })
})

describe('CoursePlanCheckout', () => {
  it('lists every plan as a radio choice with the first one chosen and its price on the button', () => {
    renderCheckout()

    expect(screen.getByRole('group', { name: 'Choose a plan' })).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(2)
    expect(radios[0]).toBeChecked()
    expect(radios[1]).not.toBeChecked()
    expect(screen.getByText('₹5,000').tagName).toBe('S')
    expect(screen.getByText('6 months of access')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buy course — ₹4,000' })).toBeInTheDocument()

    fireEvent.click(radios[1]!)
    expect(screen.getAllByRole('radio')[1]).toBeChecked()
    expect(screen.getByRole('button', { name: 'Buy course — ₹2,000' })).toBeInTheDocument()
  })

  it('says "Choose a plan to renew" and "Renew" when renewing', () => {
    renderCheckout({ renewal: true })
    expect(screen.getByRole('group', { name: 'Choose a plan to renew' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Renew — ₹4,000' })).toBeInTheDocument()
  })

  it('shows a single plan as text instead of a radio group', () => {
    renderCheckout({ plans: [plans[0]!] })
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByText('Lifetime')).toBeInTheDocument()
    expect(screen.getByText(/Lifetime access/)).toBeInTheDocument()
  })

  it('hides the promo code link while the course cannot be bought', () => {
    renderCheckout({ blockedMessage: 'Fixture course is not on sale yet.' })
    expect(screen.queryByRole('button', { name: 'Have a promo code?' })).not.toBeInTheDocument()
  })

  it('applies a promo code on the server and shows the price breakdown', async () => {
    mocks.previewCoursePriceAction.mockResolvedValue(quote())
    renderCheckout()

    fireEvent.click(screen.getByRole('button', { name: 'Have a promo code?' }))
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled()
    openAndApplyTyped(' fixture20 ')

    const breakdown = await screen.findByRole('status')
    expect(mocks.previewCoursePriceAction).toHaveBeenCalledWith(courseId, { planId: lifetimePlanId, promoCode: 'fixture20' })
    expect(breakdown).toHaveTextContent('FIXTURE20 applied')
    expect(breakdown).toHaveTextContent('Lifetime')
    expect(breakdown).toHaveTextContent('₹4,000')
    expect(breakdown).toHaveTextContent('Code FIXTURE20')
    expect(breakdown).toHaveTextContent('−₹800')
    expect(breakdown).toHaveTextContent('You pay')
    expect(breakdown).toHaveTextContent('₹3,200')
    expect(screen.getByRole('button', { name: 'Buy course — ₹3,200' })).toBeInTheDocument()
  })

  it('shows the server’s refusal and keeps the plan price', async () => {
    mocks.previewCoursePriceAction.mockResolvedValue({ ok: false, error: 'This code has expired.' })
    renderCheckout()

    openAndApply('OLDCODE')

    expect(await screen.findByRole('alert')).toHaveTextContent('This code has expired.')
    expect(screen.getByLabelText('Promo code')).toHaveAttribute('aria-invalid', 'true')
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Buy course — ₹4,000' })).toBeInTheDocument()

    // Typing again clears the refusal.
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: 'OLDCODE2' } })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('re-prices an applied code for a newly chosen plan', async () => {
    mocks.previewCoursePriceAction.mockResolvedValueOnce(quote())
    renderCheckout()
    openAndApply('FIXTURE20')
    await screen.findByRole('status')

    mocks.previewCoursePriceAction.mockResolvedValueOnce(quote({ planName: 'Six months', listLabel: '₹2,000', saleLabel: null, discountLabel: '−₹400', totalLabel: '₹1,600', amountMinor: 160000 }))
    fireEvent.click(screen.getAllByRole('radio')[1]!)

    await waitFor(() => expect(mocks.previewCoursePriceAction).toHaveBeenLastCalledWith(courseId, { planId: sixMonthPlanId, promoCode: 'FIXTURE20' }))
    expect(await screen.findByRole('button', { name: 'Buy course — ₹1,600' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('Six months')
  })

  it('removes an applied code and goes back to the plan price', async () => {
    mocks.previewCoursePriceAction.mockResolvedValue(quote())
    renderCheckout()
    openAndApply('FIXTURE20')
    await screen.findByRole('status')

    fireEvent.click(screen.getByRole('button', { name: 'Remove code' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(screen.getByLabelText('Promo code')).toHaveValue('')
    expect(screen.getByRole('button', { name: 'Buy course — ₹4,000' })).toBeInTheDocument()
  })

  it('starts checkout with the chosen plan and the applied promo code', async () => {
    mocks.previewCoursePriceAction.mockResolvedValue(quote({ planName: 'Six months', totalLabel: '₹1,600' }))
    renderCheckout()

    fireEvent.click(screen.getAllByRole('radio')[1]!)
    openAndApply('FIXTURE20')
    await screen.findByRole('status')
    fireEvent.click(screen.getByRole('button', { name: 'Buy course — ₹1,600' }))

    await waitFor(() => expect(mocks.startCourseCheckoutAction).toHaveBeenCalledWith(courseId, { planId: sixMonthPlanId, promoCode: 'FIXTURE20' }))
  })

  it('starts checkout without a plan or code for a course that has no saved plans', async () => {
    renderCheckout({ plans: [{ id: null, name: 'Standard', priceLabel: '₹999', listLabel: null, accessLabel: 'Lifetime access', currency: 'INR' }] })

    fireEvent.click(screen.getByRole('button', { name: 'Buy course — ₹999' }))

    await waitFor(() => expect(mocks.startCourseCheckoutAction).toHaveBeenCalledWith(courseId, {}))
  })
})

function openAndApplyTyped(code: string) {
  fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: code } })
  fireEvent.click(screen.getByRole('button', { name: 'Apply' }))
}

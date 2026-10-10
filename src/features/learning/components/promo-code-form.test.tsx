import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  createPromoCode: vi.fn(),
  setPromoCodeDisabled: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../promo-code-actions', () => ({
  createPromoCode: mocks.createPromoCode,
  setPromoCodeDisabled: mocks.setPromoCodeDisabled,
}))

import { PromoCodeForm } from './promo-code-form'

const courseA = { id: '22222222-2222-4222-8222-222222222222', title: 'Fixture Course A' }
const courseB = { id: '33333333-3333-4333-8333-333333333333', title: 'Fixture Course B' }

function field(label: RegExp) {
  return screen.getByLabelText(label)
}

function submit() {
  fireEvent.click(screen.getByRole('button', { name: /Create code/ }))
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.createPromoCode.mockResolvedValue({ ok: true })
})

describe('PromoCodeForm', () => {
  it('offers "All my courses" (chosen by default) only to a trainer who can code all their courses', () => {
    render(<PromoCodeForm courses={[courseA, courseB]} canCodeAllCourses />)
    const course = field(/^Course/)
    expect(course).toHaveValue('')
    expect(screen.getByRole('option', { name: 'All my courses' })).toBeInTheDocument()
    cleanup()

    render(<PromoCodeForm courses={[courseA, courseB]} canCodeAllCourses={false} />)
    expect(screen.queryByRole('option', { name: 'All my courses' })).not.toBeInTheDocument()
    expect(field(/^Course/)).toHaveValue(courseA.id)
  })

  it('creates a percentage code with the default terms', async () => {
    render(<PromoCodeForm courses={[courseA]} canCodeAllCourses />)

    fireEvent.change(field(/^Code/), { target: { value: 'fixture20' } })
    submit()

    expect(await screen.findByRole('status')).toHaveTextContent('Code created. Buyers can enter it at checkout.')
    expect(mocks.createPromoCode).toHaveBeenCalledWith({
      code: 'fixture20',
      courseId: null,
      discountType: 'percent',
      percentOff: '20',
      amountOffMinor: null,
      currency: null,
      maxDiscountMinor: null,
      usageLimit: null,
      perMemberLimit: 1,
      validFrom: null,
      validUntil: null,
    })
    expect(mocks.refresh).toHaveBeenCalled()
    // The form is reset for the next code.
    expect(field(/^Code/)).toHaveValue('')
  })

  it('converts a fixed amount, a maximum discount, limits and dates (India time) before sending', async () => {
    render(<PromoCodeForm courses={[courseA, courseB]} canCodeAllCourses />)

    fireEvent.change(field(/^Code/), { target: { value: 'FIXTURE500' } })
    fireEvent.change(field(/^Course/), { target: { value: courseB.id } })
    fireEvent.click(screen.getByRole('radio', { name: 'Fixed amount' }))
    expect(screen.queryByLabelText(/Percentage off/)).not.toBeInTheDocument()
    fireEvent.change(field(/Amount off/), { target: { value: '499.50' } })
    fireEvent.change(field(/Currency/), { target: { value: 'USD' } })
    fireEvent.change(field(/Maximum discount/), { target: { value: '1,000' } })
    fireEvent.change(field(/Total uses/), { target: { value: '100' } })
    fireEvent.change(field(/Uses per member/), { target: { value: '' } })
    fireEvent.change(field(/Valid from/), { target: { value: '2026-11-01' } })
    fireEvent.change(field(/Valid until/), { target: { value: '2026-11-30' } })
    submit()

    await waitFor(() => expect(mocks.createPromoCode).toHaveBeenCalledTimes(1))
    expect(mocks.createPromoCode).toHaveBeenCalledWith({
      code: 'FIXTURE500',
      courseId: courseB.id,
      discountType: 'fixed',
      percentOff: null,
      amountOffMinor: 49950,
      currency: 'USD',
      maxDiscountMinor: 100000,
      usageLimit: 100,
      perMemberLimit: null,
      validFrom: '2026-10-31T18:30:00.000Z',
      validUntil: '2026-11-30T18:29:59.000Z',
    })
    // The chosen course is kept after the reset.
    expect(await screen.findByRole('status')).toBeInTheDocument()
    expect(field(/^Course/)).toHaveValue(courseB.id)
  })

  it('sends the currency with a percentage code that has a maximum discount', async () => {
    render(<PromoCodeForm courses={[courseA]} canCodeAllCourses={false} />)
    fireEvent.change(field(/^Code/), { target: { value: 'CAPPED' } })
    fireEvent.change(field(/Percentage off/), { target: { value: '12.5' } })
    fireEvent.change(field(/Maximum discount/), { target: { value: '750' } })
    submit()

    await waitFor(() => expect(mocks.createPromoCode).toHaveBeenCalled())
    expect(mocks.createPromoCode.mock.calls[0]![0]).toMatchObject({ courseId: courseA.id, percentOff: '12.5', currency: 'INR', maxDiscountMinor: 75000 })
  })

  it('sends values the server will refuse for amounts and limits that are not numbers', async () => {
    render(<PromoCodeForm courses={[courseA]} canCodeAllCourses />)
    fireEvent.change(field(/^Code/), { target: { value: 'BROKEN' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Fixed amount' }))
    fireEvent.change(field(/Amount off/), { target: { value: 'five hundred' } })
    fireEvent.change(field(/Total uses/), { target: { value: '1.5' } })
    submit()

    await waitFor(() => expect(mocks.createPromoCode).toHaveBeenCalled())
    const payload = mocks.createPromoCode.mock.calls[0]![0]
    expect(payload.amountOffMinor).toBe(-1)
    expect(payload.usageLimit).toBeNaN()
  })

  it('shows the server’s field errors next to the fields and keeps what was typed', async () => {
    mocks.createPromoCode.mockResolvedValue({
      ok: false,
      error: 'Please correct the highlighted fields.',
      fieldErrors: {
        code: ['Use 3–32 letters, numbers, hyphens or underscores for the code, for example SIRE20.'],
        percentOff: ['Enter a percentage between 1 and 100.'],
        validUntil: ['The end date must be after the start date.'],
      },
    })
    render(<PromoCodeForm courses={[courseA]} canCodeAllCourses />)
    fireEvent.change(field(/^Code/), { target: { value: 'x' } })
    submit()

    expect(await screen.findByRole('alert')).toHaveTextContent('Please correct the highlighted fields.')
    expect(screen.getByText('Use 3–32 letters, numbers, hyphens or underscores for the code, for example SIRE20.')).toBeInTheDocument()
    expect(screen.getByText('Enter a percentage between 1 and 100.')).toBeInTheDocument()
    expect(screen.getByText('The end date must be after the start date.')).toBeInTheDocument()
    expect(field(/^Code/)).toHaveAttribute('aria-invalid', 'true')
    expect(field(/^Code/)).toHaveValue('x')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})

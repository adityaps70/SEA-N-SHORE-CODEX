import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ saveCoursePlans: vi.fn() }))

vi.mock('../course-plan-actions', () => ({ saveCoursePlans: mocks.saveCoursePlans }))

import { COURSE_PLAN_LIMITS, type CoursePlan } from '../course-plans'
import { CoursePricingPlansPanel } from './course-pricing-plans-panel'

const courseId = '22222222-2222-4222-8222-222222222222'
const mainPlanId = '44444444-4444-4444-8444-444444444444'
const extraPlanId = '55555555-5555-4555-8555-555555555555'

const mainPlan: CoursePlan = { id: mainPlanId, name: 'Lifetime', priceMinor: 500000, discountPriceMinor: 400000, currency: 'INR', accessMonths: null, position: 0 }
const extraPlan: CoursePlan = { id: extraPlanId, name: 'Six months', priceMinor: 250000, discountPriceMinor: null, currency: 'INR', accessMonths: 6, position: 1 }

function planItems() {
  return within(screen.getByRole('list')).getAllByRole('listitem')
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
})

describe('CoursePricingPlansPanel', () => {
  it('explains how to add plans while the course is not paid', () => {
    render(<CoursePricingPlansPanel courseId={courseId} paid={false} plans={[mainPlan]} />)
    expect(screen.getByRole('heading', { name: 'Pricing plans' })).toBeInTheDocument()
    expect(screen.getByText(/Set the course to paid with a price and save the course details to add plans/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save plans/ })).not.toBeInTheDocument()
  })

  it('shows the same message for a paid course with no plans yet', () => {
    render(<CoursePricingPlansPanel courseId={courseId} paid plans={[]} />)
    expect(screen.getByText(/save the course details to add plans/)).toBeInTheDocument()
  })

  it('shows the main plan price read-only, with its list price struck through', () => {
    render(<CoursePricingPlansPanel courseId={courseId} paid plans={[mainPlan, extraPlan]} />)

    const [main, second] = planItems()
    expect(within(main!).getByText('Main plan')).toBeInTheDocument()
    expect(within(main!).getByText('₹4,000')).toBeInTheDocument()
    expect(within(main!).getByText('₹5,000').tagName).toBe('S')
    expect(within(main!).getByText('Set the main price in the course details above.')).toBeInTheDocument()
    expect(within(main!).queryByLabelText('Price')).not.toBeInTheDocument()
    expect(within(main!).queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
    expect(within(main!).getByLabelText('Access')).toHaveValue('lifetime')

    expect(within(second!).getByText('Plan 2')).toBeInTheDocument()
    expect(within(second!).getByLabelText('Price')).toHaveValue('2500')
    expect(within(second!).getByLabelText(/Sale price/)).toHaveValue('')
    expect(within(second!).getByLabelText('Access')).toHaveValue('6')
    expect(within(second!).getByRole('button', { name: /Remove/ })).toBeInTheDocument()
  })

  it(`adds plans up to ${COURSE_PLAN_LIMITS.plans} and removes them`, () => {
    render(<CoursePricingPlansPanel courseId={courseId} paid plans={[mainPlan]} />)
    expect(planItems()).toHaveLength(1)

    for (let count = 2; count <= COURSE_PLAN_LIMITS.plans; count += 1) {
      fireEvent.click(screen.getByRole('button', { name: /Add a plan/ }))
      expect(planItems()).toHaveLength(count)
    }
    expect(screen.queryByRole('button', { name: /Add a plan/ })).not.toBeInTheDocument()

    const added = planItems()[1]!
    expect(within(added).getByLabelText('Plan name')).toHaveValue('')
    expect(within(added).getByLabelText('Access')).toHaveValue('6')
    expect(within(added).getByLabelText('Currency')).toHaveValue('INR')

    fireEvent.click(within(planItems()[3]!).getByRole('button', { name: /Remove/ }))
    expect(planItems()).toHaveLength(COURSE_PLAN_LIMITS.plans - 1)
    expect(screen.getByRole('button', { name: /Add a plan/ })).toBeInTheDocument()
  })

  it('saves the plans with prices parsed to minor units and shows the saved plans', async () => {
    mocks.saveCoursePlans.mockResolvedValue({
      ok: true,
      plans: [mainPlan, { ...extraPlan, name: 'Twelve months', priceMinor: 349950, discountPriceMinor: 299900, accessMonths: 12 }],
    })
    render(<CoursePricingPlansPanel courseId={courseId} paid plans={[mainPlan, extraPlan]} />)

    const second = planItems()[1]!
    fireEvent.change(within(second).getByLabelText('Plan name'), { target: { value: 'Twelve months' } })
    fireEvent.change(within(second).getByLabelText('Price'), { target: { value: '3,499.50' } })
    fireEvent.change(within(second).getByLabelText(/Sale price/), { target: { value: '2999' } })
    fireEvent.change(within(second).getByLabelText('Access'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: /Save plans/ }))

    expect(await screen.findByRole('status')).toHaveTextContent('Plans saved. Changes to a published course go live when the review is approved.')
    expect(mocks.saveCoursePlans).toHaveBeenCalledWith(courseId, [
      { id: mainPlanId, name: 'Lifetime', priceMinor: 500000, discountPriceMinor: 400000, currency: 'INR', accessMonths: null },
      { id: extraPlanId, name: 'Twelve months', priceMinor: 349950, discountPriceMinor: 299900, currency: 'INR', accessMonths: 12 },
    ])
    expect(within(planItems()[1]!).getByLabelText('Price')).toHaveValue('3499.50')
  })

  it('sends a new plan in USD with a null id and no sale price', async () => {
    mocks.saveCoursePlans.mockResolvedValue({ ok: true, plans: [mainPlan] })
    render(<CoursePricingPlansPanel courseId={courseId} paid plans={[mainPlan]} />)

    fireEvent.click(screen.getByRole('button', { name: /Add a plan/ }))
    const added = planItems()[1]!
    fireEvent.change(within(added).getByLabelText('Plan name'), { target: { value: 'Fixture plan' } })
    fireEvent.change(within(added).getByLabelText('Price'), { target: { value: '49' } })
    fireEvent.change(within(added).getByLabelText('Currency'), { target: { value: 'USD' } })
    fireEvent.change(within(added).getByLabelText('Access'), { target: { value: 'lifetime' } })
    fireEvent.click(screen.getByRole('button', { name: /Save plans/ }))

    await screen.findByRole('status')
    expect(mocks.saveCoursePlans.mock.calls[0]![1][1]).toEqual({ id: null, name: 'Fixture plan', priceMinor: 4900, discountPriceMinor: null, currency: 'USD', accessMonths: null })
  })

  it('refuses prices that are not numbers without calling the server', () => {
    render(<CoursePricingPlansPanel courseId={courseId} paid plans={[mainPlan, extraPlan]} />)

    fireEvent.change(within(planItems()[1]!).getByLabelText(/Sale price/), { target: { value: 'cheap' } })
    fireEvent.click(screen.getByRole('button', { name: /Save plans/ }))

    expect(screen.getByRole('alert')).toHaveTextContent('Plan 2: enter prices as numbers, for example 4999 or 4999.50.')
    expect(mocks.saveCoursePlans).not.toHaveBeenCalled()
  })

  it('refuses a new plan with an empty price', () => {
    render(<CoursePricingPlansPanel courseId={courseId} paid plans={[mainPlan, extraPlan]} />)
    fireEvent.click(screen.getByRole('button', { name: /Add a plan/ }))
    fireEvent.click(screen.getByRole('button', { name: /Save plans/ }))

    expect(screen.getByRole('alert')).toHaveTextContent('Plan 3: enter prices as numbers')
    expect(mocks.saveCoursePlans).not.toHaveBeenCalled()
  })

  it('shows the server’s error when saving fails', async () => {
    mocks.saveCoursePlans.mockResolvedValue({ ok: false, error: 'Plan 2: Plan name is required.' })
    render(<CoursePricingPlansPanel courseId={courseId} paid plans={[mainPlan, extraPlan]} />)
    fireEvent.click(screen.getByRole('button', { name: /Save plans/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Plan 2: Plan name is required.')
  })

  it('hides every control and disables the fields when read-only', () => {
    render(<CoursePricingPlansPanel courseId={courseId} paid plans={[mainPlan, extraPlan]} readOnly />)

    expect(screen.queryByRole('button', { name: /Add a plan/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save plans/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Remove/ })).not.toBeInTheDocument()
    for (const field of screen.getAllByRole('textbox')) expect(field).toBeDisabled()
    for (const field of screen.getAllByRole('combobox')) expect(field).toBeDisabled()
  })
})

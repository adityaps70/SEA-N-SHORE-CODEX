import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CourseSaleRow } from '@/features/learning/course-payment-repository'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getMentorApplicationState: vi.fn(),
  listUserOrganizations: vi.fn(),
  canAccessPlatformAdmin: vi.fn(),
  listCourseSales: vi.fn(),
  redirect: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/admin/access', () => ({ canAccessPlatformAdmin: mocks.canAccessPlatformAdmin }))
vi.mock('@/features/learning/repository', () => ({ learningRepository: { getMentorApplicationState: mocks.getMentorApplicationState } }))
vi.mock('@/features/organizations/repository', () => ({ organizationRepository: { listUserOrganizations: mocks.listUserOrganizations } }))
vi.mock('@/features/learning/course-payment-repository', () => ({ coursePaymentRepository: { listCourseSales: mocks.listCourseSales } }))
vi.mock('@/features/learning/course-payment-actions', () => ({ refundCoursePaymentAction: vi.fn() }))

import CourseSalesPage from './page'

const sale: CourseSaleRow = {
  id: '33333333-3333-4333-8333-333333333333',
  courseId: '22222222-2222-4222-8222-222222222222',
  profileId: '11111111-1111-4111-8111-111111111111',
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
  buyerName: 'Capt. Rao',
  buyerSlug: 'capt-rao',
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  mocks.requireAwsUser.mockResolvedValue({ id: 'mentor-1', email: 'mentor@example.com' })
  mocks.getMentorApplicationState.mockResolvedValue({ kind: 'mentor', mentorStatus: 'active' })
  mocks.listUserOrganizations.mockResolvedValue([])
  mocks.canAccessPlatformAdmin.mockResolvedValue(false)
  mocks.listCourseSales.mockResolvedValue([sale, { ...sale, id: 'o2', status: 'refunded', refundStatus: 'processed', refundedAt: '2030-01-02T10:00:00.000Z', buyerName: 'Chief Officer Das', buyerSlug: null }])
})

describe('/learn/studio/sales', () => {
  it('shows the trainer the purchases of their courses with totals and a refund action', async () => {
    render(await CourseSalesPage())

    expect(mocks.listCourseSales).toHaveBeenCalledWith({ managerId: 'mentor-1', allCourses: false })
    expect(screen.getByRole('heading', { name: 'Course sales' })).toBeInTheDocument()
    const totals = screen.getByRole('region', { name: 'Sales totals' })
    expect(within(totals).getByText('Paid sales (INR)')).toBeInTheDocument()
    expect(within(totals).getByText('₹4,000')).toBeInTheDocument()

    const [paid, refunded] = screen.getAllByRole('listitem')
    expect(within(paid!).getByRole('link', { name: 'Capt. Rao' })).toHaveAttribute('href', '/people/capt-rao')
    expect(within(paid!).getByText('crs_33333333333343338333333333333333')).toBeInTheDocument()
    expect(within(paid!).getByRole('button', { name: 'Refund ₹4,000' })).toBeInTheDocument()
    expect(within(refunded!).getByText('Refunded', { selector: 'span' })).toBeInTheDocument()
    expect(within(refunded!).queryByRole('button')).not.toBeInTheDocument()
  })

  it('shows platform admins every course sale', async () => {
    mocks.getMentorApplicationState.mockResolvedValueOnce({ kind: 'none' })
    mocks.canAccessPlatformAdmin.mockResolvedValueOnce(true)
    render(await CourseSalesPage())
    expect(mocks.listCourseSales).toHaveBeenCalledWith({ managerId: 'mentor-1', allCourses: true })
    expect(mocks.redirect).not.toHaveBeenCalled()
  })

  it('sends people without a course workspace away', async () => {
    mocks.getMentorApplicationState.mockResolvedValueOnce({ kind: 'none' })
    mocks.redirect.mockImplementationOnce(() => { throw new Error('NEXT_REDIRECT') })
    await expect(CourseSalesPage()).rejects.toThrow('NEXT_REDIRECT')
    expect(mocks.redirect).toHaveBeenCalledWith('/learn/teach')
    expect(mocks.listCourseSales).not.toHaveBeenCalled()
  })

  it('flags a paid purchase that never unlocked the course so it gets refunded', async () => {
    mocks.listCourseSales.mockResolvedValueOnce([{ ...sale, enrollmentConfirmedAt: null, refundDueReason: 'already_enrolled' }])
    render(await CourseSalesPage())
    expect(screen.getByText('Refund due')).toBeInTheDocument()
    expect(screen.getByText(/This learner paid but did not get access — refund them/)).toBeInTheDocument()
  })

  it('has an empty state and a clear load error', async () => {
    mocks.listCourseSales.mockResolvedValueOnce([])
    render(await CourseSalesPage())
    expect(screen.getByText('No course sales yet')).toBeInTheDocument()
    cleanup()
    mocks.listCourseSales.mockRejectedValueOnce(new Error('down'))
    render(await CourseSalesPage())
    expect(screen.getByText(/We couldn't load course sales just now/)).toBeInTheDocument()
  })
})

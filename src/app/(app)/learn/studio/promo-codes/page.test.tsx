import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAwsUser: vi.fn(),
  getMentorApplicationState: vi.fn(),
  listUserOrganizations: vi.fn(),
  listForManager: vi.fn(),
  listCodeCourses: vi.fn(),
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT:${path}`)
  }),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect, useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: mocks.requireAwsUser }))
vi.mock('@/features/learning/repository', () => ({
  learningRepository: { getMentorApplicationState: mocks.getMentorApplicationState },
}))
vi.mock('@/features/organizations/repository', () => ({
  organizationRepository: { listUserOrganizations: mocks.listUserOrganizations },
}))
vi.mock('@/features/learning/promo-code-repository', () => ({
  promoCodeRepository: { listForManager: mocks.listForManager, listCodeCourses: mocks.listCodeCourses },
}))
vi.mock('@/features/learning/promo-code-actions', () => ({ createPromoCode: vi.fn(), setPromoCodeDisabled: vi.fn() }))

import type { PromoCodeSummary } from '@/features/learning/promo-code-repository'
import PromoCodesPage from './page'

const activeMentor = {
  kind: 'mentor',
  applicationId: '11111111-1111-4111-8111-111111111111',
  status: 'approved',
  submittedAt: '2026-09-14T12:00:00.000Z',
  updatedAt: '2026-09-14T14:00:00.000Z',
  adminReviewNote: null,
  mentorId: 'mentor-1',
  mentorStatus: 'active',
}

const course = { id: '22222222-2222-4222-8222-222222222222', title: 'Fixture Course' }

function code(overrides: Partial<PromoCodeSummary>): PromoCodeSummary {
  return {
    id: '66666666-6666-4666-8666-666666666666',
    code: 'FIXTURE',
    courseId: course.id,
    courseTitle: course.title,
    terms: { discountType: 'percent', percentOff: '20', amountOffMinor: null, currency: null, maxDiscountMinor: null },
    usageLimit: null,
    perMemberLimit: 1,
    validFrom: null,
    validUntil: null,
    disabled: false,
    redemptions: 0,
    revenue: [],
    ...overrides,
  }
}

const codes: PromoCodeSummary[] = [
  code({
    id: '60000000-0000-4000-8000-000000000001',
    code: 'ACTIVE20',
    usageLimit: 100,
    redemptions: 3,
    validUntil: '2099-12-31T18:29:59.000Z',
    revenue: [
      { currency: 'INR', grossMinor: 960000, discountMinor: 240000, refunds: 1 },
      { currency: 'USD', grossMinor: 4900, discountMinor: 1100, refunds: 0 },
    ],
  }),
  code({ id: '60000000-0000-4000-8000-000000000002', code: 'STOPPED', disabled: true }),
  code({ id: '60000000-0000-4000-8000-000000000003', code: 'OLDCODE', validUntil: '2001-01-01T00:00:00.000Z' }),
  code({ id: '60000000-0000-4000-8000-000000000004', code: 'USEDUP', usageLimit: 2, redemptions: 2 }),
  code({
    id: '60000000-0000-4000-8000-000000000005',
    code: 'LATER',
    courseId: null,
    courseTitle: null,
    perMemberLimit: null,
    validFrom: '2099-01-01T00:00:00.000Z',
    terms: { discountType: 'fixed', percentOff: null, amountOffMinor: 50000, currency: 'INR', maxDiscountMinor: null },
  }),
]

function card(codeText: string) {
  return screen.getByText(codeText).closest('li')!
}

afterEach(() => cleanup())

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  mocks.requireAwsUser.mockResolvedValue({ id: 'user-1', cognitoSub: 'sub-1', email: 'fixture@example.test' })
  mocks.getMentorApplicationState.mockResolvedValue(activeMentor)
  mocks.listUserOrganizations.mockResolvedValue([])
  mocks.listForManager.mockResolvedValue(codes)
  mocks.listCodeCourses.mockResolvedValue([course])
})

describe('/learn/studio/promo-codes', () => {
  it.each([
    [{ kind: 'none' }, []],
    [{ ...activeMentor, mentorStatus: 'suspended' }, [{ id: 'company-1', slug: 'fixture-org', name: 'Fixture Org', verified: true, role: 'member' }]],
  ])('sends people without trainer or organisation access back to Teach', async (state, organizations) => {
    mocks.getMentorApplicationState.mockResolvedValue(state)
    mocks.listUserOrganizations.mockResolvedValue(organizations)

    await expect(PromoCodesPage()).rejects.toThrow('NEXT_REDIRECT:/learn/teach')
    expect(mocks.redirect).toHaveBeenCalledWith('/learn/teach')
    expect(mocks.listForManager).not.toHaveBeenCalled()
  })

  it('opens for an organisation learning manager without trainer access, without "All my courses"', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({ kind: 'none' })
    mocks.listUserOrganizations.mockResolvedValue([{ id: 'company-1', slug: 'fixture-org', name: 'Fixture Org', verified: true, role: 'lms_manager' }])

    render(await PromoCodesPage())

    expect(mocks.redirect).not.toHaveBeenCalled()
    expect(screen.getByRole('heading', { level: 1, name: 'Promo codes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'New promo code' })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: 'All my courses' })).not.toBeInTheDocument()
  })

  it('asks an organisation manager with no paid course to publish one first', async () => {
    mocks.getMentorApplicationState.mockResolvedValue({ kind: 'none' })
    mocks.listUserOrganizations.mockResolvedValue([{ id: 'company-1', slug: 'fixture-org', name: 'Fixture Org', verified: true, role: 'owner' }])
    mocks.listCodeCourses.mockResolvedValue([])

    render(await PromoCodesPage())

    expect(screen.getByText('Publish a paid course to make promo codes for it.')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'New promo code' })).not.toBeInTheDocument()
  })

  it('lists the codes with their status, terms, scope, redemptions and revenue per currency', async () => {
    render(await PromoCodesPage())

    expect(mocks.listForManager).toHaveBeenCalledWith('user-1')
    expect(mocks.listCodeCourses).toHaveBeenCalledWith('user-1')
    expect(screen.getByRole('option', { name: 'All my courses' })).toBeInTheDocument()

    const active = card('ACTIVE20')
    expect(within(active).getByText('Active')).toBeInTheDocument()
    expect(within(active).getByText('20% off · Fixture Course')).toBeInTheDocument()
    expect(within(active).getByText(/Until 31 Dec 2099 · 100 uses in total · 1 per member/)).toBeInTheDocument()
    expect(within(active).getByText('3 of 100')).toBeInTheDocument()
    expect(within(active).getByText('Revenue (INR)')).toBeInTheDocument()
    expect(within(active).getByText('₹9,600 paid, ₹2,400 discount given · 1 refunded')).toBeInTheDocument()
    expect(within(active).getByText('Revenue (USD)')).toBeInTheDocument()
    expect(within(active).getByText('$49 paid, $11 discount given')).toBeInTheDocument()
    expect(within(active).getByRole('button', { name: 'Turn off' })).toBeInTheDocument()

    const stopped = card('STOPPED')
    expect(within(stopped).getByText('Off')).toBeInTheDocument()
    expect(within(stopped).getByRole('button', { name: 'Turn on' })).toBeInTheDocument()
    expect(within(stopped).getByText(/No end date · No total limit/)).toBeInTheDocument()

    expect(within(card('OLDCODE')).getByText('Expired')).toBeInTheDocument()
    expect(within(card('USEDUP')).getByText('Used up')).toBeInTheDocument()
    expect(within(card('USEDUP')).getByText('2 of 2')).toBeInTheDocument()

    const later = card('LATER')
    expect(within(later).getByText('Scheduled')).toBeInTheDocument()
    expect(within(later).getByText('₹500 off · All my courses')).toBeInTheDocument()
    expect(within(later).getByText(/From 1 Jan 2099 · No total limit · no limit per member/)).toBeInTheDocument()
    expect(within(later).queryByText(/Revenue/)).not.toBeInTheDocument()
  })

  it('says when there are no codes yet', async () => {
    mocks.listForManager.mockResolvedValue([])
    render(await PromoCodesPage())
    expect(screen.getByText('No codes yet.')).toBeInTheDocument()
  })

  it('shows a load-failure message when the codes cannot be read', async () => {
    mocks.listForManager.mockRejectedValue(new Error('connection refused'))

    render(await PromoCodesPage())

    expect(screen.getByText('We could not load your codes just now. Refresh the page to try again.')).toBeInTheDocument()
    expect(screen.queryByText('No codes yet.')).not.toBeInTheDocument()
    expect(console.error).toHaveBeenCalledWith('promo_codes_load_failed', { message: 'connection refused' })
  })
})

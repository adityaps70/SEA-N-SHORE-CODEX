import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  check: vi.fn(),
  cancel: vi.fn(),
  open: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh, push: vi.fn() }) }))
vi.mock('../actions', () => ({
  startPlanCheckoutAction: mocks.start,
  checkPlanCheckoutAction: mocks.check,
  cancelAutoRenewAction: mocks.cancel,
}))
vi.mock('./subscription-sdk', () => ({ openSubscriptionCheckout: mocks.open }))

import { CancelAutoRenewButton } from './cancel-auto-renew'
import { PlanCheckout } from './plan-checkout'

const base = {
  target: { kind: 'personal' as const },
  planLabel: 'Creator Pro',
  prices: { month: 9900, half_year: null, year: 99900 },
  yearlySavingLabel: 'Save ₹189.00 a year — 1 month free',
  configured: true,
}

afterEach(() => {
  cleanup()
})

beforeEach(() => {
  vi.clearAllMocks()
})

describe('PlanCheckout', () => {
  it('shows a clear "not set up yet" state instead of a broken button', () => {
    render(<PlanCheckout {...base} configured={false} />)
    expect(screen.getByText('Online payment isn’t set up yet')).toBeInTheDocument()
    expect(screen.getByText('Creator Pro: ₹99.00 per month or ₹999.00 per year')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Auto-pay not available yet' })).toBeDisabled()
  })

  it('lists every available price, including half-yearly, when payment is not set up', () => {
    render(<PlanCheckout {...base} planLabel="Organization Pro" prices={{ month: 199900, half_year: 1000000, year: 1499900 }} configured={false} />)
    expect(screen.getByText('Organization Pro: ₹1,999.00 per month, ₹10,000.00 per 6 months or ₹14,999.00 per year')).toBeInTheDocument()
  })

  it('says paid plans open soon, without a button, while a trial runs and payment is not set up', () => {
    render(<PlanCheckout {...base} configured={false} trialEndsOn="1 Dec 2026" />)
    expect(screen.getByRole('status')).toHaveTextContent('Paid plans open soon')
    expect(screen.getByText('Your free trial continues until 1 Dec 2026. You’ll be able to choose a paid plan here before it ends; nothing is charged until then.')).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByText('Online payment isn’t set up yet')).not.toBeInTheDocument()
  })

  it('shows the same "open soon" note when Cashfree has no auto-pay yet and a trial is running', async () => {
    mocks.start.mockResolvedValueOnce({ ok: false, error: 'Auto-pay isn’t available yet.', reason: 'subscriptions_unavailable' })
    render(<PlanCheckout {...base} trialEndsOn="1 Dec 2026" />)
    fireEvent.click(screen.getByRole('button', { name: /Set up auto-pay/ }))
    expect(await screen.findByText('Paid plans open soon')).toBeInTheDocument()
    expect(screen.getByText(/Your free trial continues until 1 Dec 2026/)).toBeInTheDocument()
    expect(screen.queryByText('Auto-pay isn’t available yet.')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Set up auto-pay/ })).not.toBeInTheDocument()
  })

  it('keeps the plain error when auto-pay is unavailable and no trial is running', async () => {
    mocks.start.mockResolvedValueOnce({ ok: false, error: 'Auto-pay isn’t available yet.', reason: 'subscriptions_unavailable' })
    render(<PlanCheckout {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /Set up auto-pay/ }))
    expect(await screen.findByText('Auto-pay isn’t available yet.')).toBeInTheDocument()
    expect(screen.queryByText('Paid plans open soon')).not.toBeInTheDocument()
  })

  it('offers monthly, half-yearly and yearly in that order when all three have a price', () => {
    render(<PlanCheckout {...base} planLabel="Organization Pro" prices={{ month: 199900, half_year: 1000000, year: 1499900 }} yearlySavingLabel="Save ₹8,989.00 a year — 4 months free" />)
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('value'))).toEqual(['month', 'half_year', 'year'])
    const halfYearly = screen.getByRole('radio', { name: /Half-yearly/ })
    expect(halfYearly).toHaveAccessibleName(/^Half-yearly\s*₹10,000\.00 per 6 months\s*Save ₹1,994\.00 every 6 months$/)
    fireEvent.click(halfYearly)
    expect(halfYearly).toBeChecked()
    expect(screen.getByRole('button', { name: 'Set up auto-pay · ₹10,000.00 per 6 months' })).toBeInTheDocument()
    expect(screen.getByText(/₹10,000\.00 is charged every 6 months until you cancel/)).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Yearly/ })).toHaveAccessibleName(/^Yearly\s*Best value\s*₹14,999\.00 per year\s*Save ₹8,989\.00 a year — 4 months free$/)
  })

  it('lets the member choose monthly or yearly and shows the yearly saving', () => {
    render(<PlanCheckout {...base} defaultInterval="year" />)
    const yearly = screen.getByRole('radio', { name: /Yearly/ })
    expect(yearly).toBeChecked()
    expect(screen.getByText('Save ₹189.00 a year — 1 month free')).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Half-yearly/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set up auto-pay · ₹999.00 per year' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /Monthly/ }))
    expect(screen.getByRole('button', { name: 'Set up auto-pay · ₹99.00 per month' })).toBeInTheDocument()
    expect(screen.getByText(/₹99\.00 is charged every month until you cancel/)).toBeInTheDocument()
  })

  it('asks for missing contact details, then opens Cashfree and waits for the server to confirm', async () => {
    mocks.start
      .mockResolvedValueOnce({ ok: false, error: 'Our payment partner needs your mobile number and email address.', needsContact: { phone: true, email: false } })
      .mockResolvedValueOnce({ ok: true, checkoutId: 'c1', subscriptionSessionId: 'sub_session_1', mode: 'sandbox' })
    mocks.open.mockResolvedValue({ outcome: 'opened', target: '_blank' })
    mocks.check.mockResolvedValue({ state: 'active', title: 'Creator Pro is active', message: 'Auto-renew is on.' })

    render(<PlanCheckout {...base} defaultInterval="month" />)
    fireEvent.click(screen.getByRole('button', { name: /Set up auto-pay/ }))
    const phone = await screen.findByLabelText('Mobile number')
    await waitFor(() => expect(phone).toHaveFocus())
    fireEvent.click(screen.getByRole('button', { name: /Continue to Cashfree/ }))
    expect(screen.getByRole('alert')).toHaveTextContent('Enter your mobile number to continue.')
    fireEvent.change(phone, { target: { value: '98765 43210' } })
    fireEvent.click(screen.getByRole('button', { name: /Continue to Cashfree/ }))

    await screen.findByText('Finish approving auto-pay')
    expect(mocks.start).toHaveBeenLastCalledWith({ target: { kind: 'personal' }, interval: 'month', phone: '98765 43210' })
    expect(mocks.open).toHaveBeenCalledWith({ subscriptionSessionId: 'sub_session_1', mode: 'sandbox', target: '_blank' })

    fireEvent.click(screen.getByRole('button', { name: /Check status/ }))
    await screen.findByText('Creator Pro is active')
    expect(mocks.check).toHaveBeenCalledWith('c1')
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('polls the server while the member approves in the other tab', async () => {
    mocks.start.mockResolvedValue({ ok: true, checkoutId: 'c1', subscriptionSessionId: 's', mode: 'sandbox' })
    mocks.open.mockResolvedValue({ outcome: 'opened', target: '_blank' })
    mocks.check
      .mockResolvedValueOnce({ state: 'waiting', title: 'Finish approving auto-pay', message: 'Still waiting.' })
      .mockResolvedValueOnce({ state: 'pending_approval', title: 'Waiting for your bank to approve', message: 'Up to 2 working days.' })
    render(<PlanCheckout {...base} pollIntervalMs={20} />)
    fireEvent.click(screen.getByRole('button', { name: /Set up auto-pay/ }))
    expect(await screen.findByText('Waiting for your bank to approve')).toBeInTheDocument()
    expect(mocks.check).toHaveBeenCalledTimes(2)
    await new Promise((resolve) => setTimeout(resolve, 80))
    // Polling stops once the server has a final answer.
    expect(mocks.check).toHaveBeenCalledTimes(2)
  })

  it('offers to open Cashfree in this tab when the new tab was blocked', async () => {
    mocks.start.mockResolvedValue({ ok: true, checkoutId: 'c1', subscriptionSessionId: 's', mode: 'production' })
    mocks.open.mockResolvedValueOnce({ outcome: 'error', message: 'Popup blocked' }).mockResolvedValueOnce({ outcome: 'opened', target: '_self' })
    render(<PlanCheckout {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /Set up auto-pay/ }))
    await screen.findByText(/The Cashfree window didn’t open \(Popup blocked\)/)
    fireEvent.click(screen.getByRole('button', { name: 'Open in this tab' }))
    await waitFor(() => expect(mocks.open).toHaveBeenLastCalledWith({ subscriptionSessionId: 's', mode: 'production', target: '_self' }))
  })

  it('shows server errors and a blocked-script message without leaving the chooser', async () => {
    mocks.start.mockResolvedValueOnce({ ok: false, error: 'You already have this plan on auto-renew. Nothing new was set up.' })
    render(<PlanCheckout {...base} />)
    fireEvent.click(screen.getByRole('button', { name: /Set up auto-pay/ }))
    await screen.findByText('You already have this plan on auto-renew. Nothing new was set up.')

    mocks.start.mockResolvedValueOnce({ ok: true, checkoutId: 'c1', subscriptionSessionId: 's', mode: 'sandbox' })
    mocks.open.mockResolvedValueOnce({ outcome: 'unavailable' })
    fireEvent.click(screen.getByRole('button', { name: /Set up auto-pay/ }))
    await screen.findByText(/The secure Cashfree window could not load/)
    expect(screen.getByRole('radio', { name: /Monthly/ })).toBeInTheDocument()
  })

  it('explains a blocked purchase instead of showing the button', () => {
    render(<PlanCheckout {...base} blockedMessage="Organization Pro can be bought once your organization is verified." />)
    expect(screen.getByText('Organization Pro can be bought once your organization is verified.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Set up auto-pay/ })).not.toBeInTheDocument()
  })

  it('says nothing is charged today for a plan that starts later', () => {
    render(<PlanCheckout {...base} onlyInterval="year" startsOn="1 Nov 2026" submitLabel="Switch to yearly · ₹999.00 per year" />)
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.getByText(/Nothing is charged today\. Your yearly plan starts on 1 Nov 2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Switch to yearly · ₹999.00 per year' })).toBeInTheDocument()
  })
})

describe('CancelAutoRenewButton', () => {
  it('confirms in the page, closes with Escape and returns focus', async () => {
    render(<CancelAutoRenewButton target={{ kind: 'personal' }} planLabel="Creator Pro" accessUntil="1 Nov 2026" />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel auto-renew' }))
    expect(screen.getByText('Turn off auto-renew?')).toBeInTheDocument()
    expect(screen.getByText(/Creator Pro stays active until 1 Nov 2026/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Keep auto-renew' })).toHaveFocus()
    fireEvent.keyDown(screen.getByRole('button', { name: 'Keep auto-renew' }), { key: 'Escape' })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Cancel auto-renew' })).toHaveFocus())
    expect(mocks.cancel).not.toHaveBeenCalled()
  })

  it('shows the pending state and the result', async () => {
    let resolve: (value: unknown) => void = () => {}
    mocks.cancel.mockReturnValue(new Promise((done) => { resolve = done }))
    render(<CancelAutoRenewButton target={{ kind: 'personal' }} planLabel="Creator Pro" accessUntil="1 Nov 2026" />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel auto-renew' }))
    fireEvent.click(screen.getByRole('button', { name: 'Turn off auto-renew' }))
    expect(await screen.findByRole('button', { name: 'Turning off…' })).toBeDisabled()
    await act(async () => { resolve({ ok: true, message: 'Auto-renew is off. Creator Pro stays active until 1 Nov 2026, and nothing more will be charged.' }) })
    expect(screen.getByRole('status')).toHaveTextContent('Auto-renew is off.')
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('keeps the panel open with the error when cancelling fails', async () => {
    mocks.cancel.mockResolvedValue({ ok: false, error: 'Our payment partner didn’t confirm the cancellation, so auto-renew is still on. Please try again in a few minutes.' })
    render(<CancelAutoRenewButton target={{ kind: 'personal' }} planLabel="Creator Pro" accessUntil={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Cancel auto-renew' }))
    expect(screen.getByText(/ends now because no paid period is left/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Turn off auto-renew' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('auto-renew is still on')
    expect(screen.getByRole('button', { name: 'Keep auto-renew' })).toBeInTheDocument()
  })
})

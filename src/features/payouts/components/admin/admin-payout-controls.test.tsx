import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  refreshStatus: vi.fn(),
  retry: vi.fn(),
  cancel: vi.fn(),
  updateFees: vi.fn(),
  search: vi.fn(),
  setOverride: vi.fn(),
  removeOverride: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }), usePathname: () => '/admin/payments/payouts' }))
vi.mock('../../admin-actions', () => ({
  sendPayoutAction: mocks.send,
  refreshPayoutStatusAction: mocks.refreshStatus,
  retryPayoutAction: mocks.retry,
  cancelPayoutAction: mocks.cancel,
  updateFeeSettingsAction: mocks.updateFees,
  searchSellersAction: mocks.search,
  setFeeOverrideAction: mocks.setOverride,
  removeFeeOverrideAction: mocks.removeOverride,
}))

import { FeeOverrideManager } from './fee-override-manager'
import { FeeSettingsForm } from './fee-settings-form'
import { PaymentsAdminTabs } from './payments-admin-tabs'
import { PayoutStatusActions } from './payout-status-actions'
import { SendPayoutPanel } from './send-payout-panel'

const PAYOUT = '77777777-7777-4777-8777-777777777777'
const E1 = 'e1111111-1111-4111-8111-111111111111'

beforeEach(() => vi.clearAllMocks())
afterEach(() => {
  cleanup()
})

describe('SendPayoutPanel', () => {
  const props = { sellerKey: 'profile:44444444-4444-4444-8444-444444444444', sellerName: 'Arjun Rao', earningIds: [E1], totalMinor: 44910, amountLabel: '₹449.10', accountSummary: 'Bank account ••••1772 · HDFC0000001' }

  it('asks for confirmation in the page, then sends once and shows the result', async () => {
    let resolve: (value: unknown) => void = () => undefined
    mocks.send.mockReturnValue(new Promise((done) => { resolve = done }))
    render(<SendPayoutPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send ₹449.10 via Cashfree' }))
    expect(mocks.send).not.toHaveBeenCalled()
    expect(screen.getByRole('group', { name: 'Send ₹449.10 to Arjun Rao?' })).toHaveTextContent("can't be called back")
    const confirm = screen.getByRole('button', { name: 'Yes, send ₹449.10' })
    await waitFor(() => expect(confirm).toHaveFocus())
    fireEvent.click(confirm)
    expect(await screen.findByRole('button', { name: 'Sending…' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Sending…' }))
    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith({ sellerKey: props.sellerKey, earningIds: [E1], expectedTotalMinor: 44910 })
    await act(async () => resolve({ ok: true, state: 'processing', payoutId: PAYOUT, message: '₹449.10 is on its way to Arjun Rao.' }))
    expect(screen.getByRole('status')).toHaveTextContent('on its way')
    expect(screen.getByRole('link', { name: 'View this payout' })).toHaveAttribute('href', `/admin/payments/payouts/${PAYOUT}`)
    expect(screen.queryByRole('button', { name: /Send/ })).not.toBeInTheDocument()
  })

  it('closes with Escape and explains a refusal with a way to reload', async () => {
    mocks.send.mockResolvedValue({ ok: false, error: 'The balance changed after you opened this review. Nothing was sent.' })
    render(<SendPayoutPanel {...props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Send ₹449.10 via Cashfree' }))
    fireEvent.keyDown(screen.getByRole('group'), { key: 'Escape' })
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Send ₹449.10 via Cashfree' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, send ₹449.10' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was sent')
    fireEvent.click(screen.getByRole('button', { name: 'Reload this review' }))
    expect(mocks.refresh).toHaveBeenCalled()
  })
})

describe('PayoutStatusActions', () => {
  it('checks the status with Cashfree and shows the answer', async () => {
    mocks.refreshStatus.mockResolvedValue({ ok: true, state: 'success', payoutId: PAYOUT, message: '₹449.10 was paid to Arjun Rao. Bank reference (UTR): UTR1.' })
    render(<PayoutStatusActions payoutId={PAYOUT} status="processing" amountLabel="₹449.10" />)
    expect(screen.queryByRole('button', { name: 'Cancel payout' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Check status' }))
    expect(await screen.findByRole('status')).toHaveTextContent('UTR1')
    expect(mocks.refreshStatus).toHaveBeenCalledWith(PAYOUT)
  })

  it('offers send again and a confirmed cancel for an unconfirmed payout', async () => {
    mocks.cancel.mockResolvedValue({ ok: false, error: 'This payout was handed to Cashfree less than 2 minutes ago.' })
    render(<PayoutStatusActions payoutId={PAYOUT} status="draft" amountLabel="₹449.10" />)
    expect(screen.getByRole('button', { name: 'Send again' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel payout' }))
    expect(mocks.cancel).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, cancel payout' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('less than 2 minutes')
    expect(mocks.cancel).toHaveBeenCalledWith(PAYOUT)
  })
})

describe('FeeSettingsForm', () => {
  it('saves the defaults and shows field errors', async () => {
    mocks.updateFees.mockResolvedValueOnce({ ok: false, error: 'Check the highlighted fields.', fieldErrors: { defaultPercent: 'Enter a percentage from 0 to 100.' } })
    render(<FeeSettingsForm defaultPercent="10" holdDays={7} minPayout="100" />)
    fireEvent.change(screen.getByLabelText('Default platform fee'), { target: { value: '150' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save fee settings' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the highlighted fields.')
    expect(screen.getByLabelText('Default platform fee')).toHaveAttribute('aria-invalid', 'true')
    expect(mocks.updateFees).toHaveBeenCalledWith({ defaultPercent: '150', holdDays: '7', minPayout: '100' })

    mocks.updateFees.mockResolvedValueOnce({ ok: true, message: 'Saved. New sales use a 12% platform fee.' })
    fireEvent.change(screen.getByLabelText('Default platform fee'), { target: { value: '12' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save fee settings' }))
    expect(await screen.findByRole('status')).toHaveTextContent('12% platform fee')
    expect(mocks.refresh).toHaveBeenCalled()
  })
})

describe('FeeOverrideManager', () => {
  it('searches after a pause, picks a seller and saves their rate', async () => {
    mocks.search.mockResolvedValue({ ok: true, results: [{ key: 'company:55555555-5555-4555-8555-555555555555', kind: 'organization', id: '5', name: 'Blue Anchor Shipping', slug: 'blue-anchor', detail: null }] })
    mocks.setOverride.mockResolvedValue({ ok: true, message: 'Blue Anchor Shipping now pays a 5% platform fee on new sales.' })
    render(<FeeOverrideManager overrides={[]} defaultPercentLabel="10%" />)
    expect(screen.getByText(/Everyone pays the default fee of 10%/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Find a person or organization'), { target: { value: 'Blue' } })
    fireEvent.click(await screen.findByRole('button', { name: /Blue Anchor Shipping/ }, { timeout: 2000 }))
    expect(mocks.search).toHaveBeenCalledWith('Blue')
    await waitFor(() => expect(screen.getByLabelText('Their fee')).toHaveFocus())
    fireEvent.change(screen.getByLabelText('Their fee'), { target: { value: '5' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save rate' }))
    expect(await screen.findByText(/now pays a 5% platform fee/, {}, { timeout: 2000 })).toBeInTheDocument()
    expect(mocks.setOverride).toHaveBeenCalledWith({ sellerKey: 'company:55555555-5555-4555-8555-555555555555', percent: '5', note: '' })
  })

  it('removes an override only after confirmation', async () => {
    mocks.removeOverride.mockResolvedValue({ ok: true, message: 'Back on default.' })
    render(<FeeOverrideManager defaultPercentLabel="10%" overrides={[{ key: 'profile:44444444-4444-4444-8444-444444444444', name: 'Arjun Rao', kind: 'profile', percentLabel: '5%', note: 'Launch partner', updatedLabel: 'Set 1 Sep 2026' }]} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove rate' }))
    expect(mocks.removeOverride).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, use default' }))
    await waitFor(() => expect(mocks.removeOverride).toHaveBeenCalledWith('profile:44444444-4444-4444-8444-444444444444'))
  })
})

describe('PaymentsAdminTabs', () => {
  it('marks the current section', () => {
    render(<PaymentsAdminTabs />)
    expect(screen.getByRole('link', { name: 'Payouts' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current')
  })
})

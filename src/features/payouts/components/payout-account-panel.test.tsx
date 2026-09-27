import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ save: vi.fn(), remove: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../actions', () => ({ savePayoutAccountAction: mocks.save, removePayoutAccountAction: mocks.remove }))

import { PayoutAccountPanel } from './payout-account-panel'

const key = 'profile:44444444-4444-4444-8444-444444444444'
const saved = { method: 'bank' as const, summary: 'Bank account ••••1772 · HDFC0000001', holderName: 'Arjun Rao', savedAt: '2026-09-01T10:00:00.000Z', verified: true }

beforeEach(() => {
  vi.clearAllMocks()
  mocks.save.mockResolvedValue({ ok: true, message: 'Payout details saved. Payouts will go to Bank account ••••1772 · HDFC0000001.', account: { summary: saved.summary } })
  mocks.remove.mockResolvedValue({ ok: true, message: 'Payout details removed. Add new details to receive payouts again.' })
})
afterEach(() => cleanup())

function fill(label: string | RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } })
}

describe('PayoutAccountPanel', () => {
  it('invites a member without details to add them, and saves a bank account', async () => {
    render(<PayoutAccountPanel sellerKey={key} sellerName="You" kind="profile" account={null} />)
    expect(screen.getByText(/No payout details yet/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add payout details' }))
    const form = screen.getByRole('form', { name: 'Add payout details' })
    expect(form).toBeInTheDocument()
    await waitFor(() => expect(screen.getByLabelText('Account holder name')).toHaveFocus())
    fill('Account holder name', 'Arjun Rao')
    fill('Account number', '00011020001772')
    fill('Account number again', '00011020001772')
    fill('IFSC', 'hdfc0000001')
    expect(screen.getByText(/keeps only the last 4 digits and the IFSC/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Save payout details' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Payout details saved.')
    expect(mocks.save).toHaveBeenCalledWith(key, { method: 'bank', holderName: 'Arjun Rao', accountNumber: '00011020001772', confirmAccountNumber: '00011020001772', ifsc: 'hdfc0000001', vpa: '' })
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('switches to UPI and shows field errors from the server', async () => {
    mocks.save.mockResolvedValueOnce({ ok: false, error: 'Check the highlighted fields.', fieldErrors: { vpa: 'Enter a UPI ID like name@bank.' } })
    render(<PayoutAccountPanel sellerKey={key} sellerName="You" kind="profile" account={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add payout details' }))
    fireEvent.click(screen.getByLabelText(/UPI ID/, { selector: 'input[type=radio]' }))
    expect(screen.queryByLabelText('Account number')).not.toBeInTheDocument()
    fill('Account holder name', 'Arjun Rao')
    fill(/^UPI ID$/, 'arjun')
    fireEvent.click(screen.getByRole('button', { name: 'Save payout details' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Check the highlighted fields.')
    expect(screen.getByText('Enter a UPI ID like name@bank.')).toBeInTheDocument()
    expect(screen.getByLabelText(/^UPI ID$/)).toHaveAttribute('aria-invalid', 'true')
  })

  it('shows a pending state while saving and blocks a second submit', async () => {
    let resolve: (value: unknown) => void = () => undefined
    mocks.save.mockReturnValue(new Promise((done) => { resolve = done }))
    render(<PayoutAccountPanel sellerKey={key} sellerName="You" kind="profile" account={null} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add payout details' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save payout details' }))
    const pendingButton = await screen.findByRole('button', { name: 'Saving with Cashfree…' })
    expect(pendingButton).toBeDisabled()
    fireEvent.submit(screen.getByRole('form'))
    expect(mocks.save).toHaveBeenCalledTimes(1)
    resolve({ ok: false, error: "We couldn't reach our payout partner, Cashfree. Nothing was saved." })
    expect(await screen.findByRole('alert')).toHaveTextContent('Nothing was saved')
  })

  it('shows masked saved details and asks before removing (Escape cancels)', async () => {
    render(<PayoutAccountPanel sellerKey={key} sellerName="You" kind="profile" account={saved} />)
    expect(screen.getByText('Bank account ••••1772 · HDFC0000001')).toBeInTheDocument()
    expect(screen.getByText('Verified by the bank')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    const group = screen.getByRole('group', { name: /Remove Bank account ••••1772/ })
    await waitFor(() => expect(screen.getByRole('button', { name: 'Yes, remove details' })).toHaveFocus())
    fireEvent.keyDown(group, { key: 'Escape' })
    expect(screen.queryByRole('group')).not.toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Replace details' })).toHaveFocus())
    expect(mocks.remove).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove details' }))
    expect(await screen.findByRole('status')).toHaveTextContent('Payout details removed.')
    expect(mocks.remove).toHaveBeenCalledWith(key)
  })

  it('locks the details while a payout is on its way', () => {
    render(<PayoutAccountPanel sellerKey="company:55555555-5555-4555-8555-555555555555" sellerName="Blue Anchor Shipping" kind="organization" account={saved} lockedReason="A payout is on its way to these details." />)
    expect(screen.getByRole('heading', { name: 'Blue Anchor Shipping' })).toBeInTheDocument()
    expect(screen.getByText('A payout is on its way to these details.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Replace details' })).not.toBeInTheDocument()
  })
})

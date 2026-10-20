import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ check: vi.fn(), refresh: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../../admin-actions', () => ({ checkCashfreeConnectionAction: mocks.check }))

import { PaymentsHealthCard } from './payments-health-card'

const health = {
  allOk: true,
  lines: [
    { id: 'pg_keys' as const, label: 'Payment Gateway keys', tone: 'ok' as const, value: 'Present · PROD', detail: null },
    { id: 'payouts_last_call' as const, label: 'Last Payouts call', tone: 'ok' as const, value: 'Accepted 20 Oct 2026, 3:00 pm', detail: null },
  ],
}

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('PaymentsHealthCard (hotfix P1)', () => {
  it('lists each line with its status for screen readers and runs the Cashfree check on request', async () => {
    mocks.check.mockResolvedValue({ ok: false, error: 'Payouts: Cashfree refused the call because our server address is not on the Payouts IP whitelist.' })
    render(<PaymentsHealthCard health={health} />)
    expect(screen.getByRole('region', { name: /Payments health/ })).toHaveTextContent('All good')
    expect(screen.getByRole('list', { name: 'Payments health' }).children).toHaveLength(2)
    expect(screen.getByTestId('payments-health-pg_keys')).toHaveTextContent('OK: Present · PROD')
    fireEvent.click(screen.getByRole('button', { name: 'Check Cashfree now' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('not on the Payouts IP whitelist')
    expect(mocks.check).toHaveBeenCalledTimes(1)
    expect(mocks.refresh).toHaveBeenCalled()
  })
})

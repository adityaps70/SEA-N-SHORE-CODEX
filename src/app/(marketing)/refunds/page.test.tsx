import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import RefundsPage from './page'

afterEach(() => cleanup())

describe('/refunds', () => {
  it('covers every paid product with the stated rules', () => {
    render(<RefundsPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Refund & cancellation policy' })).toBeVisible()
    expect(screen.getByText('Last updated: 28 September 2026')).toBeVisible()

    expect(screen.getByRole('heading', { name: 'Paid event tickets' })).toBeVisible()
    expect(screen.getByText(/full refund if you ask at least 48 hours before the event starts/)).toBeVisible()
    expect(screen.getByText(/your ticket stays valid for the new date/)).toBeVisible()

    expect(screen.getByRole('heading', { name: 'Paid courses' })).toBeVisible()
    expect(screen.getByText(/within 7 days of purchase, you have completed less than 20% of the course and no certificate has been issued/)).toBeVisible()

    expect(screen.getByRole('heading', { name: /Creator Pro and Organization Pro/ })).toBeVisible()
    expect(screen.getByText('We do not refund partly used periods.')).toBeVisible()
    expect(screen.getByText('Charges made in error and duplicate charges are refunded in full.')).toBeVisible()
  })

  it('explains how to ask, the timeline, the gateway and the seller side', () => {
    render(<RefundsPage />)
    expect(screen.getByText(/processed within 5–7 working days to the original payment method/)).toBeVisible()
    expect(screen.getAllByText(/Cashfree Payments/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Beaufort Marine Services LLP/).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('link', { name: 'info@beaufortmarine.in' })[0]).toHaveAttribute('href', 'mailto:info@beaufortmarine.in')
    expect(screen.getByRole('link', { name: 'Earnings' })).toHaveAttribute('href', '/settings/earnings')
    expect(screen.getByText(/If a payment failed, you have not been charged/)).toBeVisible()
  })
})

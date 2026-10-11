import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  requireAdmin: vi.fn(async () => ({ id: 'admin-1' })),
  inviteMetrics: vi.fn(async () => ({ eligible: 3, prepared: 0, queued: 0, sending: 0, sent: 4547, failed: 0, skipped: 0, cancelled: 0 })),
  inviteRecent: vi.fn(async () => [{
    id: 'i1', email: 'old@example.com', fullName: 'Old Member', status: 'sent', attempts: 1,
    sentAt: '2026-10-03T10:00:00.000Z', lastEvent: 'delivered', lastEventAt: '2026-10-03T10:01:00.000Z', lastError: null,
  }]),
  backfill: vi.fn(async () => ({ total: 4547, checked: 1200, remaining: 3347 })),
  breakdown: vi.fn(async () => ({
    total: 4600,
    eligible: 3100,
    excluded: { first_not_sent: 53, already_reminded: 0, too_recent: 0, bounced_or_suppressed: 120, not_delivered: 900, claimed: 300, has_account: 100, opted_out: 27 },
  })),
  reminderMetrics: vi.fn(async () => ({ prepared: 10, queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, cancelled: 0 })),
  reminderRecent: vi.fn(async () => []),
  sendTest: vi.fn(async () => ({ status: 'sent', to: 'admin@example.test' })),
}))

vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requireAdmin }))
vi.mock('@/features/legacy-invites/admin-actions', () => ({
  prepareLegacyInviteBatch: vi.fn(), startPreparedLegacyInvites: vi.fn(), cancelPreparedLegacyInvites: vi.fn(), stopUnsentLegacyInvites: vi.fn(),
  prepareLegacyReminderBatch: vi.fn(), startPreparedLegacyReminders: vi.fn(), cancelPreparedLegacyReminders: vi.fn(), stopUnsentLegacyReminders: vi.fn(),
  sendLegacyReminderTest: mocks.sendTest,
}))
vi.mock('@/features/legacy-invites/repository', () => ({ legacyInviteRepository: { metrics: mocks.inviteMetrics, recent: mocks.inviteRecent } }))
vi.mock('@/features/email-delivery/repository', () => ({ emailDeliveryRepository: { backfillProgress: mocks.backfill } }))
vi.mock('@/features/legacy-invites/reminder-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/legacy-invites/reminder-repository')>()),
  legacyReminderRepository: { breakdown: mocks.breakdown, metrics: mocks.reminderMetrics, recent: mocks.reminderRecent },
}))

import LegacyInvitesAdminPage from './page'

afterEach(cleanup)

describe('Admin → Legacy invites', () => {
  it('fills the Last event column from Resend and shows backfill progress on the first invitation tab', async () => {
    render(await LegacyInvitesAdminPage({ searchParams: Promise.resolve({}) }))
    expect(screen.getByRole('link', { name: 'First invitation' })).toHaveAttribute('aria-current', 'page')
    const row = screen.getByRole('row', { name: /Old Member/ })
    expect(within(row).getByText('delivered')).toBeInTheDocument()
    expect(screen.getByText(/1200 of 4547 checked, 3347 to go/)).toBeInTheDocument()
    expect(mocks.breakdown).not.toHaveBeenCalled()
  })

  it('shows every exclusion count before preparing, the reminder controls and the exact reminder email', async () => {
    render(await LegacyInvitesAdminPage({ searchParams: Promise.resolve({ mode: 'reminder' }) }))
    expect(mocks.requireAdmin).toHaveBeenCalled()
    expect(screen.getByRole('link', { name: 'Second reminder' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Eligible now').nextSibling).toHaveTextContent('3100')
    for (const [label, value] of [
      ['First invitation was never sent', '53'],
      ['Bounced, complained or suppressed', '120'],
      ['Delivery not confirmed', '900'],
      ['Profile already claimed', '300'],
      ['Has a Sea N Shore account with this email', '100'],
      ['Opted out', '27'],
      ['First invitation sent less than 7 days ago', '0'],
      ['Reminder already prepared or sent', '0'],
    ]) expect(screen.getByRole('row', { name: new RegExp(label) })).toHaveTextContent(value)

    expect(screen.getByRole('button', { name: /Start sending 10/ })).toBeEnabled()
    expect(screen.getByText('Reminder: your Sea N Shore profile is waiting')).toBeInTheDocument()
    expect(screen.getByText('One minute to reclaim your old seaandshore.in account.')).toBeInTheDocument()
    expect(screen.getByText('List-Unsubscribe-Post')).toBeInTheDocument()
    expect(screen.getAllByText('Sea N Shore <accounts@mail.seanshore.in>').length).toBeGreaterThan(0)
    const frame = screen.getByTitle('Second reminder email preview preview')
    expect(frame).toHaveAttribute('sandbox', '')
    expect(frame.getAttribute('srcdoc')).toContain('src="https://seanshore.in/brand/email/sea-n-shore-logo.png"')
    expect(frame.getAttribute('srcdoc')).toContain('<strong>captain@example.com</strong>')
  })

  it('has a "Send test to me" button with no recipient field, and shows where the test went', async () => {
    render(await LegacyInvitesAdminPage({ searchParams: Promise.resolve({ mode: 'reminder' }) }))
    const section = screen.getByRole('heading', { name: 'Send yourself a test' }).closest('section')!
    expect(within(section).queryByRole('textbox')).toBeNull()
    expect(section.querySelector('input, select, textarea')).toBeNull()

    fireEvent.click(within(section).getByRole('button', { name: 'Send test to me' }))

    expect(await within(section).findByText('Test sent to admin@example.test. It is not a reminder and changes nothing.')).toBeInTheDocument()
    expect(mocks.sendTest).toHaveBeenCalledTimes(1)
    expect(mocks.sendTest).toHaveBeenCalledWith()
  })

  it('says when the hourly test limit is reached', async () => {
    mocks.sendTest.mockResolvedValueOnce({ status: 'rate_limited' } as never)
    render(await LegacyInvitesAdminPage({ searchParams: Promise.resolve({ mode: 'reminder' }) }))
    fireEvent.click(screen.getByRole('button', { name: 'Send test to me' }))
    expect(await screen.findByText('No test was sent: you have sent 5 tests in the last hour. Try again later.')).toBeInTheDocument()
  })
})

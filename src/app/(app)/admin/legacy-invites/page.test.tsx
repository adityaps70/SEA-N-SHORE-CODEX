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
  finalBreakdown: vi.fn(async () => ({
    total: 4600,
    eligible: 2000,
    excluded: {
      first_not_sent: 53, reminder_not_sent: 1500, already_final: 0, too_recent: 400, bounced_or_suppressed: 150,
      not_delivered: 200, claimed: 150, has_account: 100, opted_out: 40, duplicate_email: 7,
    },
  })),
  finalMetrics: vi.fn(async () => ({ prepared: 0, queued: 0, sending: 0, sent: 100, failed: 0, skipped: 0, cancelled: 0 })),
  finalControls: vi.fn(async (): Promise<{ paused: boolean; pausedReason: string | null; pausedAt: string | null; resumedAt: string | null; resumedByName: string | null }> => ({
    paused: false, pausedReason: null, pausedAt: null, resumedAt: null, resumedByName: null,
  })),
  finalRates: vi.fn(async () => ({ sent: 100, bounced: 2, complained: 0, bounceRate: 0.02, complaintRate: 0 })),
  finalBatch: vi.fn(async () => ({
    size: 100, finished: 100, lastSentAt: '2026-11-09T10:00:00.000Z', opensAt: new Date(Date.now() + 5 * 3_600_000 + 20 * 60_000).toISOString(),
    open: false, delivered: 97, bounced: 2, complained: 0, clicked: 11,
  })),
  finalClaims: vi.fn(async () => 4),
  liveCounts: vi.fn(async () => ({ openJobs: 321, courses: null, upcomingEvents: 6 })),
  resume: vi.fn(async () => ({ status: 'step_up_required' })),
}))

vi.mock('@/features/admin/access', () => ({ requirePlatformAdministratorUser: mocks.requireAdmin }))
// Any next/link on this page renders with a marker, so the test can tell a client navigation from a full page load.
vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => <a href={href} data-client-navigation="true" {...props}>{children}</a>,
}))
vi.mock('@/features/legacy-invites/admin-actions', () => ({
  prepareLegacyInviteBatch: vi.fn(), startPreparedLegacyInvites: vi.fn(), cancelPreparedLegacyInvites: vi.fn(), stopUnsentLegacyInvites: vi.fn(),
  prepareLegacyReminderBatch: vi.fn(), startPreparedLegacyReminders: vi.fn(), cancelPreparedLegacyReminders: vi.fn(), stopUnsentLegacyReminders: vi.fn(),
  sendLegacyReminderTest: mocks.sendTest,
}))
vi.mock('@/features/legacy-invites/final-reminder-admin-actions', () => ({
  prepareLegacyFinalReminderBatch: vi.fn(), startPreparedLegacyFinalReminders: vi.fn(), cancelPreparedLegacyFinalReminders: vi.fn(),
  stopUnsentLegacyFinalReminders: vi.fn(), resumeLegacyFinalReminders: mocks.resume, sendLegacyFinalReminderTest: vi.fn(),
}))
vi.mock('@/features/legacy-invites/final-reminder-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/legacy-invites/final-reminder-repository')>()),
  legacyFinalReminderRepository: {
    breakdown: mocks.finalBreakdown, metrics: mocks.finalMetrics, controls: mocks.finalControls, rates: mocks.finalRates,
    firstBatch: mocks.finalBatch, claimsFromClicks: mocks.finalClaims,
  },
}))
vi.mock('@/features/legacy-invites/live-counts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/legacy-invites/live-counts')>()),
  legacyLiveCounts: { read: mocks.liveCounts },
}))
vi.mock('@/features/legacy-invites/repository', () => ({ legacyInviteRepository: { metrics: mocks.inviteMetrics, recent: mocks.inviteRecent } }))
vi.mock('@/features/email-delivery/repository', () => ({ emailDeliveryRepository: { backfillProgress: mocks.backfill } }))
vi.mock('@/features/legacy-invites/reminder-repository', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/legacy-invites/reminder-repository')>()),
  legacyReminderRepository: { breakdown: mocks.breakdown, metrics: mocks.reminderMetrics, recent: mocks.reminderRecent },
}))

import LegacyInvitesAdminPage from './page'
import { legacyFinalReminderEmail } from '@/features/legacy-invites/final-reminder-email'

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

  it('has a Final reminder mode with every exclusion count, the rates, the first-batch gate and clicks, counts only', async () => {
    render(await LegacyInvitesAdminPage({ searchParams: Promise.resolve({ mode: 'final' }) }))
    expect(screen.getByRole('link', { name: 'Final reminder' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Final reminder' })).toHaveAttribute('href', '/admin/legacy-invites?mode=final')
    expect(screen.getByText('Eligible now').nextSibling).toHaveTextContent('2000')
    for (const [label, value] of [
      ['First invitation was never sent', '53'],
      ['Second reminder was never sent', '1500'],
      ['Final reminder already prepared or sent', '0'],
      ['Second reminder sent less than 14 days ago', '400'],
      ['Bounced, complained or suppressed on an earlier email', '150'],
      ['Delivery of the first invitation or second reminder not confirmed', '200'],
      ['Profile already claimed', '150'],
      ['Has a Sea N Shore account with this email', '100'],
      ['Opted out', '40'],
      ['More than one legacy profile has this email', '7'],
    ]) expect(screen.getByRole('row', { name: new RegExp(label) })).toHaveTextContent(value)
    expect(screen.getByText('Bounce rate').nextSibling).toHaveTextContent('2.00%')
    expect(screen.getByText('Complaint rate').nextSibling).toHaveTextContent('0.00%')
    expect(screen.getByText(/Finished\. More can be prepared in 5 h (19|20) min/)).toBeInTheDocument()
    expect(screen.getByText('Batch clicked').nextSibling).toHaveTextContent('11')
    expect(screen.getByText('Claims from this email').nextSibling).toHaveTextContent('4')
    expect(screen.queryByRole('button', { name: 'Resume' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Prepare 10' })).toBeEnabled()
    expect(screen.queryByRole('table', { name: /Recent/ })).toBeNull()
  })

  it('previews exactly the email the worker sends: same render function, sample person and live counts', async () => {
    render(await LegacyInvitesAdminPage({ searchParams: Promise.resolve({ mode: 'final' }) }))
    const expected = legacyFinalReminderEmail({
      fullName: 'Captain Example',
      email: 'captain@example.com',
      clickToken: '33333333-3333-4333-8333-333333333333',
      unsubscribeToken: '22222222-2222-4222-8222-222222222222',
      counts: { openJobs: 321, courses: null, upcomingEvents: 6 },
    })
    const frame = screen.getByTitle('Final reminder email preview preview')
    expect(frame).toHaveAttribute('sandbox', '')
    expect(frame.getAttribute('srcdoc')).toBe(expected.html)
    expect(screen.getByText('Last reminder: your Sea N Shore profile is still waiting')).toBeInTheDocument()
    expect(screen.getByText('List-Unsubscribe-Post')).toBeInTheDocument()
    const plain = screen.getByText('Show plain-text version').closest('details')!.querySelector('pre')!
    expect(plain.textContent).toBe(expected.text)
    expect(expected.text).toContain('Verified jobs: 321 open right now')
  })

  it('while paused, shows why, blocks preparing and offers Resume, which asks for the admin step-up', async () => {
    mocks.finalControls.mockResolvedValueOnce({ paused: true, pausedReason: 'Complaint rate 0.20% is above 0.1% (2 of 1000 sent)', pausedAt: '2026-11-09T10:00:00.000Z', resumedAt: null, resumedByName: null })
    mocks.finalMetrics.mockResolvedValueOnce({ prepared: 5, queued: 0, sending: 0, sent: 1000, failed: 0, skipped: 0, cancelled: 0 })
    render(await LegacyInvitesAdminPage({ searchParams: Promise.resolve({ mode: 'final' }) }))
    expect(screen.getByText(/Complaint rate 0\.20% is above 0\.1%/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Prepare 10' })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Start sending 5/ })).toBeDisabled()
    vi.spyOn(window, 'confirm').mockReturnValueOnce(true)
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }))
    expect(await screen.findByText(/Not resumed: confirm your password and authenticator code first/)).toBeInTheDocument()
    expect(mocks.resume).toHaveBeenCalledTimes(1)
  })

  it('switches mode with full page loads, so each tab always shows its own mode (Second and Final reminder too)', async () => {
    const expected = {
      invite: { tab: 'First invitation', href: '/admin/legacy-invites', heading: /backfill|checked/ },
      reminder: { tab: 'Second reminder', href: '/admin/legacy-invites?mode=reminder', heading: /Eligible now/ },
      final: { tab: 'Final reminder', href: '/admin/legacy-invites?mode=final', heading: /Eligible now/ },
    } as const
    for (const mode of ['invite', 'reminder', 'final', 'invite'] as const) {
      const { container, unmount } = render(await LegacyInvitesAdminPage({ searchParams: Promise.resolve(mode === 'invite' ? {} : { mode }) }))
      // The content is keyed on the mode it was rendered for.
      expect(container.querySelector('[data-legacy-mode]')).toHaveAttribute('data-legacy-mode', mode)
      const nav = screen.getByRole('navigation', { name: 'Legacy invitation mode' })
      for (const [key, tab] of Object.entries(expected)) {
        const link = within(nav).getByRole('link', { name: tab.tab })
        expect(link).toHaveAttribute('href', tab.href)
        // A plain link: the browser loads the page, the client router never reuses the previous mode's content.
        expect(link).not.toHaveAttribute('data-client-navigation')
        if (key === mode) expect(link).toHaveAttribute('aria-current', 'page')
        else expect(link).not.toHaveAttribute('aria-current')
      }
      expect(screen.getAllByText(expected[mode].heading).length).toBeGreaterThan(0)
      unmount()
    }
  })
})

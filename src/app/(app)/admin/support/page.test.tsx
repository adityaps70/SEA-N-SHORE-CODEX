import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listTicketsForAdmin: vi.fn(),
  getTicketForAdmin: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('@/features/support/repository', () => ({ supportRepository: { listTicketsForAdmin: mocks.listTicketsForAdmin, getTicketForAdmin: mocks.getTicketForAdmin } }))
vi.mock('@/features/support/admin-actions', () => ({
  replyToTicketAsAdmin: Object.assign(vi.fn(), { bind: () => vi.fn() }),
  closeTicketAsAdmin: vi.fn(),
  reopenTicketAsAdmin: vi.fn(),
}))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }))

import AdminSupportPage from './page'
import AdminSupportTicketPage from './[ticketId]/page'

const TICKET = '33333333-3333-4333-8333-333333333333'

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('Admin › Support (round H, H7)', () => {
  it('lists requests filtered by status (open by default) with counts', async () => {
    mocks.listTicketsForAdmin.mockResolvedValue({
      counts: { open: 2, answered: 1, closed: 4 },
      tickets: [{ id: TICKET, topic: 'payments', status: 'open', createdAt: '2026-10-10T06:00:00.000Z', lastMessageAt: '2026-10-10T06:00:00.000Z', preview: 'Placeholder question', senderName: 'Placeholder Sender', senderEmail: 'sender@example.com', signedIn: false, messageCount: 1 }],
    })
    render(await AdminSupportPage({ searchParams: Promise.resolve({}) }))
    expect(mocks.listTicketsForAdmin).toHaveBeenCalledWith({ status: 'open', limit: 51, offset: 0 })
    const filters = screen.getByRole('navigation', { name: 'Filter requests by status' })
    expect(within(filters).getByRole('link', { name: /Open/ })).toHaveAttribute('aria-current', 'true')
    expect(within(filters).getByRole('link', { name: /All/ })).toHaveTextContent('7')
    const row = screen.getByRole('link', { name: /SNS-33333333 · Payments/ })
    expect(row).toHaveAttribute('href', `/admin/support/${TICKET}`)
    expect(within(row).getByText('Visitor (email only)')).toBeVisible()
  })

  it('reads the status filter and shows an empty state', async () => {
    mocks.listTicketsForAdmin.mockResolvedValue({ counts: { open: 0, answered: 0, closed: 0 }, tickets: [] })
    render(await AdminSupportPage({ searchParams: Promise.resolve({ status: 'closed', page: '2' }) }))
    expect(mocks.listTicketsForAdmin).toHaveBeenCalledWith({ status: 'closed', limit: 51, offset: 50 })
    expect(screen.getByText('No requests here.')).toBeVisible()
  })

  it('shows a request with the sender, the thread, a reply box and close', async () => {
    mocks.getTicketForAdmin.mockResolvedValue({
      id: TICKET, topic: 'account', status: 'open', senderName: 'Placeholder Sender', senderEmail: 'sender@example.com', senderProfileId: null,
      createdAt: '2026-10-10T06:00:00.000Z', closedAt: null,
      messages: [{ id: 'm1', authorRole: 'visitor', authorName: null, body: 'Placeholder question', createdAt: '2026-10-10T06:00:00.000Z' }],
    })
    render(await AdminSupportTicketPage({ params: Promise.resolve({ ticketId: TICKET }) }))
    expect(screen.getByRole('heading', { name: 'Request SNS-33333333' })).toBeVisible()
    expect(screen.getByRole('link', { name: 'sender@example.com' })).toHaveAttribute('href', 'mailto:sender@example.com')
    expect(screen.getByText('Visitor, not signed in (gets replies by email only)')).toBeVisible()
    expect(within(screen.getByRole('list', { name: 'Messages' })).getByText('Placeholder Sender (visitor)')).toBeVisible()
    expect(screen.getByLabelText('Reply to the sender')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Close request' })).toBeEnabled()
  })

  it('offers reopen instead of a reply on a closed request, and 404s for an unknown one', async () => {
    mocks.getTicketForAdmin.mockResolvedValueOnce({
      id: TICKET, topic: 'account', status: 'closed', senderName: 'Placeholder Sender', senderEmail: 'sender@example.com', senderProfileId: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-10-10T06:00:00.000Z', closedAt: '2026-10-11T06:00:00.000Z', messages: [],
    })
    render(await AdminSupportTicketPage({ params: Promise.resolve({ ticketId: TICKET }) }))
    expect(screen.queryByLabelText('Reply to the sender')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reopen request' })).toBeEnabled()
    mocks.getTicketForAdmin.mockResolvedValueOnce(null)
    await expect(AdminSupportTicketPage({ params: Promise.resolve({ ticketId: TICKET }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

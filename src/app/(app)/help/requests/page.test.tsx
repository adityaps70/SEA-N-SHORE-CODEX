import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  listTicketsForMember: vi.fn(),
  getTicketForMember: vi.fn(),
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND') }),
}))

vi.mock('@/features/auth/queries', () => ({ requireUser: async () => ({ id: '22222222-2222-4222-8222-222222222222', cognitoSub: 'sub', email: null }) }))
vi.mock('@/features/support/repository', () => ({ supportRepository: { listTicketsForMember: mocks.listTicketsForMember, getTicketForMember: mocks.getTicketForMember } }))
vi.mock('@/features/support/actions', () => ({ replyToMyTicket: Object.assign(vi.fn(), { bind: () => vi.fn() }) }))
vi.mock('next/navigation', () => ({ notFound: mocks.notFound, useRouter: () => ({ refresh: vi.fn() }) }))

import MyRequestsPage from './page'
import MyRequestPage from './[ticketId]/page'

const TICKET = '33333333-3333-4333-8333-333333333333'

beforeEach(() => vi.clearAllMocks())
afterEach(() => cleanup())

describe('Help › My requests (round H, H7)', () => {
  it('lists the member’s requests with their status', async () => {
    mocks.listTicketsForMember.mockResolvedValue([
      { id: TICKET, topic: 'account', status: 'answered', createdAt: '2026-10-10T06:00:00.000Z', lastMessageAt: '2026-10-11T06:00:00.000Z', preview: 'I lost my authenticator app.' },
    ])
    render(await MyRequestsPage())
    expect(screen.getByRole('heading', { level: 1, name: 'My requests' })).toBeVisible()
    const link = screen.getByRole('link', { name: /Account and sign-in · SNS-33333333/ })
    expect(link).toHaveAttribute('href', `/help/requests/${TICKET}`)
    expect(within(link).getByText('Answered')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Send a new message' })).toHaveAttribute('href', '/contact#contact-form')
  })

  it('explains an empty list and a loading failure', async () => {
    mocks.listTicketsForMember.mockResolvedValueOnce([])
    render(await MyRequestsPage())
    expect(screen.getByText('You have not sent us a message yet.')).toBeVisible()
    cleanup()
    mocks.listTicketsForMember.mockRejectedValueOnce(new Error('down'))
    render(await MyRequestsPage())
    expect(screen.getByRole('alert')).toHaveTextContent('could not be loaded')
  })

  it('shows one request with its thread and a labelled reply box while it is open', async () => {
    mocks.getTicketForMember.mockResolvedValue({
      id: TICKET, topic: 'account', status: 'answered', senderName: 'Placeholder Sender', senderEmail: 'sender@example.com', senderProfileId: '22222222-2222-4222-8222-222222222222',
      createdAt: '2026-10-10T06:00:00.000Z', closedAt: null,
      messages: [
        { id: 'm1', authorRole: 'member', authorName: null, body: 'I lost my authenticator app.', createdAt: '2026-10-10T06:00:00.000Z' },
        { id: 'm2', authorRole: 'admin', authorName: null, body: 'Placeholder answer from support.', createdAt: '2026-10-11T06:00:00.000Z' },
      ],
    })
    render(await MyRequestPage({ params: Promise.resolve({ ticketId: TICKET }) }))
    expect(screen.getByRole('heading', { level: 1, name: 'Request SNS-33333333' })).toBeVisible()
    const thread = screen.getByRole('list', { name: 'Messages' })
    expect(within(thread).getByText('You')).toBeVisible()
    expect(within(thread).getByText('Sea N Shore support')).toBeVisible()
    expect(screen.getByLabelText('Your reply')).toBeInTheDocument()
  })

  it('offers a new message instead of a reply on a closed request, and 404s for someone else’s', async () => {
    mocks.getTicketForMember.mockResolvedValueOnce({
      id: TICKET, topic: 'other', status: 'closed', senderName: 'Placeholder Sender', senderEmail: 'sender@example.com', senderProfileId: 'x',
      createdAt: '2026-10-10T06:00:00.000Z', closedAt: '2026-10-12T06:00:00.000Z', messages: [],
    })
    render(await MyRequestPage({ params: Promise.resolve({ ticketId: TICKET }) }))
    expect(screen.queryByLabelText('Your reply')).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'send a new message' })).toHaveAttribute('href', '/contact#contact-form')

    mocks.getTicketForMember.mockResolvedValueOnce(null)
    await expect(MyRequestPage({ params: Promise.resolve({ ticketId: TICKET }) })).rejects.toThrow('NEXT_NOT_FOUND')
  })
})

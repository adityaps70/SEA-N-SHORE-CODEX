import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ManagedAccessRequest } from '../access-request-repository'

const mocks = vi.hoisted(() => ({
  decide: vi.fn(),
  escalate: vi.fn(),
  withdraw: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../access-request-actions', () => ({
  decideOrganizationAccessRequest: mocks.decide,
  escalateOrganizationAccessRequest: mocks.escalate,
  withdrawOrganizationAccessRequest: mocks.withdraw,
}))

import { OrganizationRequestsPanel } from './organization-requests-panel'

const nowIso = '2026-09-27T12:00:00.000Z'

function request(overrides: Partial<ManagedAccessRequest> = {}): ManagedAccessRequest {
  return {
    id: 'request-1',
    status: 'pending',
    requestedRole: 'recruiter',
    grantedRole: null,
    message: 'I lead crewing in Mumbai.',
    requestedAt: '2026-09-25T12:00:00.000Z',
    reviewedAt: null,
    reviewerNote: null,
    reviewerName: null,
    decidedVia: null,
    escalatedAt: null,
    escalationNote: null,
    requester: { id: 'u1', fullName: 'Asha Singh', slug: 'asha-singh', headline: 'Crewing Manager' },
    ...overrides,
  }
}

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.decide.mockResolvedValue({ ok: true })
})

describe('OrganizationRequestsPanel', () => {
  it('approves with the role the admin confirms', async () => {
    render(<OrganizationRequestsPanel organizationName="Oceanic Shipping" requests={[request()]} nowIso={nowIso} />)

    expect(screen.getByRole('heading', { name: /Requests/ })).toHaveTextContent('1 waiting')
    expect(screen.getByText('Sent 2 days ago')).toBeInTheDocument()
    const role = screen.getByRole('combobox', { name: 'Role to grant' })
    expect(role).toHaveValue('recruiter')
    fireEvent.change(role, { target: { value: 'member' } })
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))

    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith({ requestId: 'request-1', decision: 'approved', grantedRole: 'member', note: null }))
    expect(await screen.findByRole('status')).toHaveTextContent('Asha Singh was approved as Member / employee.')
    expect(screen.getByText(/No requests are waiting/)).toBeInTheDocument()
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('declines with an optional note after a confirmation step', async () => {
    render(<OrganizationRequestsPanel organizationName="Oceanic Shipping" requests={[request()]} nowIso={nowIso} />)
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }))
    fireEvent.change(screen.getByRole('textbox', { name: /Note to Asha Singh/ }), { target: { value: 'Not on our crew list.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Confirm decline' }))

    await waitFor(() => expect(mocks.decide).toHaveBeenCalledWith({ requestId: 'request-1', decision: 'rejected', grantedRole: null, note: 'Not on our crew list.' }))
  })

  it('shows the server message when the decision is refused and keeps the request', async () => {
    mocks.decide.mockResolvedValueOnce({ ok: false, error: 'Only the owner or an administrator of this organization can decide its access requests.' })
    render(<OrganizationRequestsPanel organizationName="Oceanic Shipping" requests={[request()]} nowIso={nowIso} />)
    fireEvent.click(screen.getByRole('button', { name: 'Approve' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only the owner or an administrator')
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeEnabled()
  })

  it('shows escalated requests without decision controls', () => {
    render(
      <OrganizationRequestsPanel
        organizationName="Oceanic Shipping"
        requests={[request({ escalatedAt: '2026-09-26T12:00:00.000Z', escalationNote: 'No reply in a week.' })]}
        nowIso={nowIso}
      />,
    )
    expect(screen.getByText('With Sea N Shore')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
  })

  it('is read-only for platform administrators and lists recent decisions', () => {
    render(
      <OrganizationRequestsPanel
        organizationName="Oceanic Shipping"
        readOnly
        requests={[
          request({ requestedAt: '2026-09-17T12:00:00.000Z' }),
          request({ id: 'request-2', status: 'approved', grantedRole: 'member', reviewedAt: '2026-09-26T12:00:00.000Z', reviewerName: 'Ravi Owner', decidedVia: 'organization' }),
        ]}
        nowIso={nowIso}
      />,
    )
    expect(screen.getByText(/Read-only: the owner and administrators of Oceanic Shipping decide/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.getByText('Waiting 10 days')).toBeInTheDocument()
    const history = screen.getByText(/Recent decisions/).closest('details')!
    expect(within(history).getByText(/Approved as Member \/ employee by Ravi Owner yesterday/)).toBeInTheDocument()
  })
})

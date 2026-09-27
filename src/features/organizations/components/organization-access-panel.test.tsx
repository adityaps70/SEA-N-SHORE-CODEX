import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CompanyAccessRequestSummary } from '../types'

const mocks = vi.hoisted(() => ({
  escalate: vi.fn(),
  withdraw: vi.fn(),
  refresh: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../access-request-actions', () => ({
  escalateOrganizationAccessRequest: mocks.escalate,
  withdrawOrganizationAccessRequest: mocks.withdraw,
}))

import { OrganizationAccessPanel, requesterStatus } from './organization-access-panel'

const nowIso = '2026-09-27T12:00:00.000Z'

function request(overrides: Partial<CompanyAccessRequestSummary> = {}): CompanyAccessRequestSummary {
  return {
    id: 'request-1',
    status: 'pending',
    requestedRole: 'recruiter',
    grantedRole: null,
    requestType: 'recruiter_access',
    message: null,
    requestedAt: '2026-09-26T12:00:00.000Z',
    reviewedAt: null,
    reviewerNote: null,
    decidedVia: null,
    escalatedAt: null,
    escalationNote: null,
    company: { id: 'c1', slug: 'oceanic', name: 'Oceanic Shipping', verified: true },
    ...overrides,
  }
}

afterEach(() => cleanup())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.escalate.mockResolvedValue({ ok: true })
  mocks.withdraw.mockResolvedValue({ ok: true })
})

describe('requester status', () => {
  it('says who the request is waiting on, instead of "Sea N Shore review"', () => {
    expect(requesterStatus(request(), nowIso)).toEqual({
      tone: 'warning',
      label: 'Waiting for the organization',
      detail: 'Sent yesterday to the owner and administrators of Oceanic Shipping.',
    })
  })

  it('shows approvals with the granted role and who decided', () => {
    expect(requesterStatus(request({ status: 'approved', grantedRole: 'member', decidedVia: 'organization', reviewedAt: '2026-09-27T09:00:00.000Z' }), nowIso))
      .toMatchObject({ label: 'Approved as Member / employee', detail: 'Approved by Oceanic Shipping today.' })
    expect(requesterStatus(request({ status: 'rejected', decidedVia: 'platform', reviewedAt: '2026-09-27T09:00:00.000Z' }), nowIso).detail)
      .toMatch(/^Sea N Shore reviewed this request/)
    expect(requesterStatus(request({ escalatedAt: '2026-09-27T09:00:00.000Z' }), nowIso).label).toBe('With Sea N Shore')
  })
})

describe('OrganizationAccessPanel', () => {
  it('only offers escalation after 7 days of waiting', () => {
    const { rerender } = render(<OrganizationAccessPanel initialRequests={[request()]} nowIso={nowIso} />)
    expect(screen.queryByRole('button', { name: /Ask Sea N Shore/ })).not.toBeInTheDocument()

    rerender(<OrganizationAccessPanel initialRequests={[request({ requestedAt: '2026-09-19T12:00:00.000Z' })]} nowIso={nowIso} />)
    expect(screen.getByRole('button', { name: 'Ask Sea N Shore to step in' })).toBeInTheDocument()
  })

  it('lets the requester escalate an organization rejection with a message', async () => {
    render(
      <OrganizationAccessPanel
        initialRequests={[request({ status: 'rejected', decidedVia: 'organization', reviewedAt: '2026-09-26T12:00:00.000Z', reviewerNote: 'Not on our crew list.' })]}
        nowIso={nowIso}
      />,
    )
    expect(screen.getByText('Not approved')).toBeInTheDocument()
    expect(screen.getByText(/Not on our crew list/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Ask Sea N Shore to review' }))
    fireEvent.change(screen.getByRole('textbox', { name: /What should Sea N Shore know/ }), { target: { value: 'I joined in August; contract attached.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Send to Sea N Shore' }))

    await waitFor(() => expect(mocks.escalate).toHaveBeenCalledWith('request-1', 'I joined in August; contract attached.'))
    expect(await screen.findByRole('status')).toHaveTextContent('Sent to Sea N Shore')
  })

  it('does not offer escalation of a Sea N Shore decision', () => {
    render(<OrganizationAccessPanel initialRequests={[request({ status: 'rejected', decidedVia: 'platform' })]} nowIso={nowIso} />)
    expect(screen.queryByRole('button', { name: /Ask Sea N Shore/ })).not.toBeInTheDocument()
  })

  it('confirms before withdrawing and shows server errors', async () => {
    mocks.withdraw.mockResolvedValueOnce({ ok: false, error: 'Only requests that are still waiting can be withdrawn.' })
    render(<OrganizationAccessPanel initialRequests={[request()]} nowIso={nowIso} />)
    fireEvent.click(screen.getByRole('button', { name: 'Withdraw' }))
    expect(screen.getByText('Withdraw your request to Oceanic Shipping?')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Yes, withdraw' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Only requests that are still waiting')
  })
})

import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelationshipControls } from './relationship-controls'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('../actions', () => ({
  followProfile: vi.fn(async () => ({ ok: true })),
  unfollowProfile: vi.fn(async () => ({ ok: true })),
  sendConnectionRequest: vi.fn(async () => ({ ok: true })),
  cancelConnectionRequest: vi.fn(async () => ({ ok: true })),
  acceptConnectionRequest: vi.fn(async () => ({ ok: true })),
  declineConnectionRequest: vi.fn(async () => ({ ok: true })),
  removeConnection: vi.fn(async () => ({ ok: true })),
  blockProfile: vi.fn(async () => ({ ok: true })),
}))

const profileId = '22222222-2222-4222-8222-222222222222'

afterEach(() => cleanup())

describe('RelationshipControls', () => {
  it('shows Follow and Connect for an unrelated profile', () => {
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'none', connectionId: null } }} />)
    expect(screen.getByRole('button', { name: 'Follow' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('shows Following independently of connection state', () => {
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: true, connection: { kind: 'none', connectionId: null } }} />)
    expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
  })

  it('shows Pending and Cancel for an outgoing request', () => {
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'outgoing_pending', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }} />)
    expect(screen.getByText('Pending')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
  })

  it('shows Accept and Decline for an incoming request', () => {
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'incoming_pending', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }} />)
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Decline' })).toBeInTheDocument()
  })

  it('shows Connected and Remove for an accepted connection', () => {
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'connected', connectionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' } }} />)
    expect(screen.getByText('Connected')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument()
  })

  it('includes blocking without fake badges or reputation', () => {
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'none', connectionId: null } }} />)
    expect(screen.getByRole('button', { name: 'Block' })).toBeInTheDocument()
    expect(screen.queryByText(/Verified|Reputation/i)).not.toBeInTheDocument()
  })
})

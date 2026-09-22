import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelationshipControls } from './relationship-controls'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/features/messaging/components/start-conversation-button', () => ({
  StartConversationButton: ({ targetProfileId }: { targetProfileId: string }) => (
    <button type="button" data-profile-id={targetProfileId}>Message</button>
  ),
}))
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
const connectionId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

afterEach(() => cleanup())

describe('RelationshipControls', () => {
  it('shows Connect as the primary relationship action and keeps Follow under a dismissible More menu', async () => {
    const user = userEvent.setup()
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'none', connectionId: null } }} />)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
    const more = screen.getByRole('button', { name: 'More' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()

    await user.click(more)
    expect(screen.getByRole('menu')).toBeVisible()
    expect(screen.getByRole('menuitem', { name: 'Follow' })).toBeVisible()

    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('shows Following independently of connection state', () => {
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: true, connection: { kind: 'none', connectionId: null } }} />)
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: 'Following' })).toBeInTheDocument()
  })

  it('shows Pending and moves request cancellation under More', () => {
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'outgoing_pending', connectionId } }} />)
    expect(screen.getByText('Pending')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: 'Cancel request' })).toBeInTheDocument()
  })

  it('shows Accept and keeps Decline under More for an incoming request', () => {
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'incoming_pending', connectionId } }} />)
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: 'Decline' })).toBeInTheDocument()
  })

  it('shows Message and moves removal under More for an accepted connection', () => {
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'connected', connectionId } }} />)
    expect(screen.getByRole('button', { name: 'Message' })).toBeInTheDocument()
    expect(screen.queryByText('Connected')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: 'Remove connection' })).toBeInTheDocument()
  })

  it('reconciles mounted optimistic state when canonical relationship props change', () => {
    const { rerender } = render(
      <RelationshipControls
        profileId={profileId}
        initialRelationship={{ following: false, connection: { kind: 'outgoing_pending', connectionId } }}
      />,
    )

    expect(screen.getByText('Pending')).toBeInTheDocument()

    rerender(
      <RelationshipControls
        profileId={profileId}
        initialRelationship={{ following: true, connection: { kind: 'connected', connectionId } }}
      />,
    )

    expect(screen.getByRole('button', { name: 'Message' })).toBeInTheDocument()
    expect(screen.queryByText('Pending')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: 'Following' })).toBeInTheDocument()
  })

  it('supports an icon-only overflow menu for connection list rows', () => {
    render(
      <RelationshipControls
        profileId={profileId}
        initialRelationship={{ following: true, connection: { kind: 'connected', connectionId } }}
        compact
        menuIconOnly
      />,
    )

    expect(screen.getByText('Message')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'More actions' })).toBeInTheDocument()
    expect(screen.queryByText(/^More$/)).not.toBeInTheDocument()
  })

  it('closes More with Escape without requiring a second click on the trigger', () => {
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'none', connectionId: null } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menu')).toBeVisible()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
  })

  it('includes blocking without fake badges or reputation', () => {
    render(<RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'none', connectionId: null } }} />)
    fireEvent.click(screen.getByRole('button', { name: 'More' }))
    expect(screen.getByRole('menuitem', { name: 'Block' })).toBeInTheDocument()
    expect(screen.queryByText(/Verified|Reputation/i)).not.toBeInTheDocument()
  })
})

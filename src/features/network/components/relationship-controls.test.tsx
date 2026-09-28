import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RelationshipControls } from './relationship-controls'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }))
vi.mock('@/features/messaging/components/start-conversation-button', () => ({
  StartConversationButton: ({ targetProfileId }: { targetProfileId: string }) => (
    <button type="button" data-profile-id={targetProfileId}>Message</button>
  ),
}))
vi.mock('@/features/moderation/components/report-content-button', () => ({
  ReportContentButton: ({ targetType, targetId, onClose }: { targetType: string; targetId: string; onClose?: () => void }) => (
    <div role="dialog" aria-label={`Report ${targetType}`} data-target-id={targetId}>
      <button type="button" onClick={onClose}>Close report</button>
    </div>
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

  describe('public profile variant (phone sheet)', () => {
    it('lists Follow, Cancel request, Block and Report profile in the "…" sheet', () => {
      render(
        <RelationshipControls
          profileId={profileId}
          initialRelationship={{ following: false, connection: { kind: 'outgoing_pending', connectionId } }}
          variant="profile"
          reportProfile
        />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'More' }))
      const menu = screen.getByRole('menu', { name: 'Relationship actions' })
      expect(menu.className).toContain('max-md:!fixed')
      expect(screen.getByRole('menuitem', { name: 'Follow' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Cancel request' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Block' })).toBeInTheDocument()
      const report = screen.getByRole('menuitem', { name: 'Report profile' })
      // Desktop keeps its separate Report profile button, so this row is phone-only.
      expect(report).toHaveClass('md:hidden')
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument()
    })

    it('shows Decline for an incoming request and Remove connection when connected', () => {
      const { unmount } = render(
        <RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'incoming_pending', connectionId } }} variant="profile" reportProfile />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'More' }))
      expect(screen.getByRole('menuitem', { name: 'Decline' })).toBeInTheDocument()
      unmount()

      render(
        <RelationshipControls profileId={profileId} initialRelationship={{ following: true, connection: { kind: 'connected', connectionId } }} variant="profile" reportProfile />,
      )
      expect(screen.getByRole('button', { name: 'Message' })).toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'More' }))
      expect(screen.getByRole('menuitem', { name: 'Following' })).toBeInTheDocument()
      expect(screen.getByRole('menuitem', { name: 'Remove connection' })).toBeInTheDocument()
    })

    it('opens the report dialog for this profile from Report profile', () => {
      render(
        <RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'none', connectionId: null } }} variant="profile" reportProfile />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'More' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Report profile' }))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Report profile' })).toHaveAttribute('data-target-id', profileId)
      fireEvent.click(screen.getByRole('button', { name: 'Close report' }))
      expect(screen.queryByRole('dialog', { name: 'Report profile' })).not.toBeInTheDocument()
    })

    it('blocks from the sheet', async () => {
      const actions = await import('../actions')
      render(
        <RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'none', connectionId: null } }} variant="profile" reportProfile />,
      )
      fireEvent.click(screen.getByRole('button', { name: 'More' }))
      fireEvent.click(screen.getByRole('menuitem', { name: 'Block' }))
      await waitFor(() => expect(actions.blockProfile).toHaveBeenCalledWith(profileId))
    })

    it('opens the sheet from the page bar "…" event', () => {
      render(
        <RelationshipControls profileId={profileId} initialRelationship={{ following: false, connection: { kind: 'none', connectionId: null } }} variant="profile" openMenuEvent="sns:test-open" />,
      )
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      act(() => { window.dispatchEvent(new Event('sns:test-open')) })
      expect(screen.getByRole('menu', { name: 'Relationship actions' })).toBeInTheDocument()
      expect(screen.queryByRole('menuitem', { name: 'Report profile' })).not.toBeInTheDocument()
    })
  })
})

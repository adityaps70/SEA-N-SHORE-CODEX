import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RelationshipState } from '../types'
import { PersonCardActions } from './person-card-actions'

const refresh = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh }) }))
vi.mock('@/features/messaging/components/start-conversation-button', () => ({
  StartConversationButton: ({ targetProfileId, variant }: { targetProfileId: string; variant?: string }) => (
    <button type="button" data-profile-id={targetProfileId} data-variant={variant ?? 'default'}>Message</button>
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
const none: RelationshipState = { following: false, connection: { kind: 'none', connectionId: null } }

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderCard(relationship: RelationshipState = none, layout: 'card' | 'row' = 'card') {
  return render(<PersonCardActions profileId={profileId} slug="meera-nair" fullName="Meera Nair" initialRelationship={relationship} layout={layout} />)
}

describe('PersonCardActions (search result cards)', () => {
  it('shows Connect, Follow, View profile and a "…" menu with Report and Block', async () => {
    const actions = await import('../actions')
    renderCard()
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveClass('bg-navy-950', 'text-white')
    expect(screen.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/people/meera-nair')
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Meera Nair' }))
    const menu = screen.getByRole('menu', { name: 'Actions for Meera Nair' })
    expect(menu.parentElement).toBe(document.body)
    expect(screen.getByRole('menuitem', { name: 'Report' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Block' }))
    await waitFor(() => expect(actions.blockProfile).toHaveBeenCalledWith(profileId))

    fireEvent.click(screen.getByRole('button', { name: 'Connect' }))
    // The optimistic state lands in a transition; wait for it instead of asserting synchronously.
    expect(await screen.findByRole('button', { name: 'Pending — withdraw request' })).toBeInTheDocument()
    await waitFor(() => expect(actions.sendConnectionRequest).toHaveBeenCalledWith(profileId))
  })

  it('toggles Follow / Following optimistically', async () => {
    const actions = await import('../actions')
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Follow' }))
    expect(screen.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true')
    await waitFor(() => expect(actions.followProfile).toHaveBeenCalledWith(profileId))
  })

  it('lets a sent request be withdrawn from the Pending button or the menu', async () => {
    const actions = await import('../actions')
    renderCard({ following: false, connection: { kind: 'outgoing_pending', connectionId } })
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Meera Nair' }))
    expect(screen.getByRole('menuitem', { name: 'Withdraw request' })).toBeInTheDocument()
    act(() => { fireEvent.pointerDown(document.body) })
    fireEvent.click(screen.getByRole('button', { name: 'Pending — withdraw request' }))
    expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument()
    await waitFor(() => expect(actions.cancelConnectionRequest).toHaveBeenCalledWith(connectionId))
  })

  it('offers Accept and Decline for an incoming request', async () => {
    const actions = await import('../actions')
    renderCard({ following: false, connection: { kind: 'incoming_pending', connectionId } })
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Meera Nair' }))
    expect(screen.getByRole('menuitem', { name: 'Decline' })).toBeInTheDocument()
    act(() => { fireEvent.pointerDown(document.body) })
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }))
    expect(screen.getByRole('button', { name: 'Message' })).toBeInTheDocument()
    await waitFor(() => expect(actions.acceptConnectionRequest).toHaveBeenCalledWith(connectionId))
  })

  it('shows Message only once connected, with Remove connection in the menu', () => {
    renderCard({ following: true, connection: { kind: 'connected', connectionId } })
    expect(screen.getByRole('button', { name: 'Message' })).toHaveAttribute('data-profile-id', profileId)
    expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Following' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Meera Nair' }))
    expect(screen.getByRole('menuitem', { name: 'Remove connection' })).toBeInTheDocument()
  })

  it('opens the report dialog from the menu', () => {
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Meera Nair' }))
    fireEvent.click(screen.getByRole('menuitem', { name: 'Report' }))
    expect(screen.getByRole('dialog', { name: 'Report profile' })).toHaveAttribute('data-target-id', profileId)
    fireEvent.click(screen.getByRole('button', { name: 'Close report' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('on phone rows keeps one pill plus a "…" that also carries Follow and View profile', () => {
    renderCard(none, 'row')
    expect(screen.getByRole('button', { name: 'Connect' })).toHaveClass('rounded-full', 'min-h-9')
    expect(screen.queryByRole('link', { name: 'View profile' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'More actions for Meera Nair' }))
    expect(screen.getByRole('menuitem', { name: 'Follow' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'View profile' })).toHaveAttribute('href', '/people/meera-nair')
    expect(screen.getByRole('menuitem', { name: 'Report' })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Block' })).toBeInTheDocument()
  })

  it('follows the server’s relationship when the page refreshes with new data', () => {
    const { rerender } = renderCard({ following: false, connection: { kind: 'outgoing_pending', connectionId } })
    expect(screen.getByRole('button', { name: 'Pending — withdraw request' })).toBeInTheDocument()
    rerender(<PersonCardActions profileId={profileId} slug="meera-nair" fullName="Meera Nair" initialRelationship={{ following: true, connection: { kind: 'connected', connectionId } }} />)
    expect(screen.getByRole('button', { name: 'Message' })).toBeInTheDocument()
  })
})

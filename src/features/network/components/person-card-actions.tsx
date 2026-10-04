'use client'

import { useRouter } from 'next/navigation'
import { Ban, Check, Clock3, Ellipsis, Flag, UserMinus, UserPlus, UserRound, UserRoundCheck, UserRoundPlus, X } from 'lucide-react'
import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from '@/components/ui/action-menu'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'
import { StartConversationButton } from '@/features/messaging/components/start-conversation-button'
import { cn } from '@/lib/cn'
import {
  acceptConnectionRequest,
  blockProfile,
  cancelConnectionRequest,
  declineConnectionRequest,
  followProfile,
  removeConnection,
  sendConnectionRequest,
  unfollowProfile,
} from '../actions'
import type { RelationshipState } from '../types'

/**
 * The full action set of a person card, as on the network cards: the primary relationship
 * action (Connect / Pending with withdraw / Accept / Message once connected), Follow or
 * Following, View profile and a "…" menu with Report and Block (plus Withdraw request,
 * Decline or Remove connection when they apply). `layout="row"` is the compact phone row:
 * the primary pill and the "…" (which then also carries Follow and View profile).
 */

const PRIMARY = 'inline-flex min-h-10 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-navy-950 px-4 text-sm font-semibold text-white transition hover:bg-navy-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-60'
const OUTLINE = 'inline-flex min-h-10 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-full border border-navy-900 bg-white px-3 text-sm font-semibold text-navy-900 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-60'
const PILL = "relative inline-flex min-h-9 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-ocean-700 bg-white px-3.5 text-[13px] font-semibold text-ocean-700 transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-60"
const MORE_ICON = 'grid size-10 shrink-0 cursor-pointer place-items-center rounded-full border border-mist-200 bg-white text-navy-900 transition hover:border-ocean-500 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500'

function relationshipKey(relationship: RelationshipState) {
  return `${relationship.following ? '1' : '0'}:${relationship.connection.kind}:${relationship.connection.connectionId ?? ''}`
}

export function PersonCardActions({
  profileId,
  slug,
  fullName,
  initialRelationship,
  layout = 'card',
}: {
  profileId: string
  slug: string
  fullName: string
  initialRelationship: RelationshipState
  layout?: 'card' | 'row'
}) {
  const router = useRouter()
  const canonicalKey = relationshipKey(initialRelationship)
  const [lastCanonicalKey, setLastCanonicalKey] = useState(canonicalKey)
  const [relationship, setRelationship] = useState(initialRelationship)
  const [awaitingRefresh, setAwaitingRefresh] = useState(false)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')
  const [menuOpen, setMenuOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)

  if (lastCanonicalKey !== canonicalKey) {
    setLastCanonicalKey(canonicalKey)
    setRelationship(initialRelationship)
    setAwaitingRefresh(false)
  }

  function run(optimistic: RelationshipState, action: () => Promise<{ ok: true } | { ok: false; error: string }>, options: { awaitRefresh?: boolean } = {}) {
    const previous = relationship
    setRelationship(optimistic)
    setError('')
    if (options.awaitRefresh) setAwaitingRefresh(true)
    startTransition(async () => {
      const result = await action()
      if (!result.ok) {
        setRelationship(previous)
        setAwaitingRefresh(false)
        setError(result.error)
        return
      }
      setAwaitingRefresh(true)
      router.refresh()
    })
  }

  const connection = relationship.connection
  const connectionId = connection.connectionId
  const row = layout === 'row'

  const connect = () => run({ ...relationship, connection: { kind: 'outgoing_pending', connectionId: profileId } }, () => sendConnectionRequest(profileId), { awaitRefresh: true })
  const withdraw = () => { if (connectionId && !awaitingRefresh) run({ ...relationship, connection: { kind: 'none', connectionId: null } }, () => cancelConnectionRequest(connectionId)) }
  const accept = () => { if (connectionId && !awaitingRefresh) run({ following: true, connection: { kind: 'connected', connectionId } }, () => acceptConnectionRequest(connectionId)) }
  const decline = () => { if (connectionId && !awaitingRefresh) run({ ...relationship, connection: { kind: 'none', connectionId: null } }, () => declineConnectionRequest(connectionId)) }
  const remove = () => { if (connectionId && !awaitingRefresh) run({ ...relationship, connection: { kind: 'none', connectionId: null } }, () => removeConnection(connectionId)) }
  const toggleFollow = () => run({ ...relationship, following: !relationship.following }, () => (relationship.following ? unfollowProfile(profileId) : followProfile(profileId)))
  function block() {
    setError('')
    startTransition(async () => {
      const result = await blockProfile(profileId)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  const primary = connection.kind === 'none' ? (
    <button type="button" disabled={pending} onClick={connect} className={row ? PILL : PRIMARY}>
      {row ? null : <UserPlus aria-hidden="true" className="size-4" />}
      Connect
    </button>
  ) : connection.kind === 'outgoing_pending' ? (
    <button
      type="button"
      disabled={pending || awaitingRefresh}
      onClick={withdraw}
      title="Withdraw your connection request"
      aria-label="Pending — withdraw request"
      className={cn(row ? PILL : OUTLINE, !row && 'w-full flex-none')}
    >
      <Clock3 aria-hidden="true" className="size-4" />
      Pending
    </button>
  ) : connection.kind === 'incoming_pending' ? (
    <button type="button" disabled={pending || awaitingRefresh} onClick={accept} className={row ? PILL : PRIMARY}>
      <Check aria-hidden="true" className="size-4" />
      Accept
    </button>
  ) : (
    // Messaging is open between connections only.
    row
      ? <StartConversationButton targetProfileId={profileId} variant="pill" />
      : <StartConversationButton targetProfileId={profileId} className="w-full rounded-full" />
  )

  const menu = (
    <>
      <button
        ref={menuTriggerRef}
        type="button"
        aria-label={`More actions for ${fullName}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen((value) => !value)}
        className={cn(MORE_ICON, row && 'size-9 border-transparent')}
      >
        <Ellipsis aria-hidden="true" className="size-5" />
      </button>
      <ActionMenu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuTriggerRef} label={`Actions for ${fullName}`} className="w-56">
        {row ? (
          <>
            <ActionMenuItem disabled={pending} onClick={() => { setMenuOpen(false); toggleFollow() }} icon={relationship.following ? <UserRoundCheck aria-hidden="true" /> : <UserRoundPlus aria-hidden="true" />}>
              {relationship.following ? 'Following' : 'Follow'}
            </ActionMenuItem>
            <Link href={`/people/${slug}`} role="menuitem" onClick={() => setMenuOpen(false)} className="flex min-h-9 w-full items-center gap-3 rounded-lg px-3 text-left text-sm font-semibold text-navy-950 hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none [&>svg]:size-4 max-md:min-h-13 max-md:gap-4 max-md:px-4 max-md:text-[15px] max-md:[&>svg]:size-5">
              <UserRound aria-hidden="true" />
              View profile
            </Link>
          </>
        ) : null}
        {connection.kind === 'outgoing_pending' ? (
          <ActionMenuItem disabled={pending || awaitingRefresh} onClick={() => { setMenuOpen(false); withdraw() }} icon={<X aria-hidden="true" />}>Withdraw request</ActionMenuItem>
        ) : null}
        {connection.kind === 'incoming_pending' ? (
          <ActionMenuItem disabled={pending || awaitingRefresh} onClick={() => { setMenuOpen(false); decline() }} icon={<X aria-hidden="true" />}>Decline</ActionMenuItem>
        ) : null}
        {connection.kind === 'connected' ? (
          <ActionMenuItem disabled={pending || awaitingRefresh} onClick={() => { setMenuOpen(false); remove() }} icon={<UserMinus aria-hidden="true" />}>Remove connection</ActionMenuItem>
        ) : null}
        {row || connection.kind !== 'none' ? <ActionMenuSeparator /> : null}
        <ActionMenuItem tone="danger" onClick={() => { setMenuOpen(false); setReporting(true) }} icon={<Flag aria-hidden="true" />}>Report</ActionMenuItem>
        <ActionMenuItem tone="danger" disabled={pending} onClick={() => { setMenuOpen(false); block() }} icon={<Ban aria-hidden="true" />}>Block</ActionMenuItem>
      </ActionMenu>
    </>
  )

  return (
    <div className={row ? 'flex items-center gap-1' : 'space-y-2'} data-testid="person-card-actions">
      {row ? (
        <>
          {primary}
          {menu}
        </>
      ) : (
        <>
          <div>{primary}</div>
          <div className="flex items-center gap-2">
            <button type="button" disabled={pending} onClick={toggleFollow} aria-pressed={relationship.following} className={OUTLINE}>
              {relationship.following ? <UserRoundCheck aria-hidden="true" className="size-4" /> : <UserRoundPlus aria-hidden="true" className="size-4" />}
              {relationship.following ? 'Following' : 'Follow'}
            </button>
            <Link href={`/people/${slug}`} className={OUTLINE}>
              <UserRound aria-hidden="true" className="size-4" />
              View profile
            </Link>
            {menu}
          </div>
        </>
      )}
      {reporting ? (
        <ReportContentButton targetType="profile" targetId={profileId} label="Report profile" hideTrigger defaultOpen onClose={() => setReporting(false)} />
      ) : null}
      {error ? <p role="alert" className={cn('text-xs font-medium text-red-700', row && 'max-w-40')}>{error}</p> : null}
    </div>
  )
}

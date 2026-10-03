'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { Ban, Check, Clock3, Ellipsis, Flag, UserMinus, UserPlus, UserRoundCheck, UserRoundPlus, X } from 'lucide-react'
import { ActionMenu, ActionMenuItem } from '@/components/ui/action-menu'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'
import { cn } from '@/lib/cn'
import { useRouter } from 'next/navigation'
import { StartConversationButton } from '@/features/messaging/components/start-conversation-button'
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

/** Public profile header on phones: one wide filled pill, an outline pill and a round "…". */
/** Phones, list rows (compact + icon-only menu): Message becomes a 44px outline icon button so the name keeps its width. */
const PHONE_MESSAGE_ICON = 'max-md:size-11 max-md:min-h-11 max-md:gap-0 max-md:rounded-full max-md:border max-md:border-ocean-700 max-md:bg-white max-md:p-0 max-md:text-[0px] max-md:text-ocean-700 max-md:hover:bg-ocean-50 max-md:[&>svg]:size-5'
const PHONE_PRIMARY_PILL = 'max-md:inline-flex max-md:min-h-11 max-md:flex-1 max-md:items-center max-md:justify-center max-md:gap-2 max-md:rounded-full max-md:border-ocean-700 max-md:bg-ocean-700 max-md:px-4 max-md:text-[15px] max-md:hover:bg-ocean-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500'
const PHONE_PENDING_PILL = 'max-md:min-h-11 max-md:flex-1 max-md:justify-center max-md:gap-2 max-md:rounded-full max-md:border max-md:border-mist-300 max-md:bg-white max-md:text-[15px] max-md:text-navy-700'
const PHONE_MESSAGE_PILL = 'max-md:min-h-11 max-md:rounded-full max-md:bg-ocean-700 max-md:text-[15px] max-md:hover:bg-ocean-800'
const PHONE_MORE_ROUND = 'max-md:size-11 max-md:min-h-0 max-md:justify-center max-md:rounded-full max-md:border-ocean-700 max-md:px-0 max-md:text-ocean-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500'

function relationshipStateKey(relationship: RelationshipState) {
  return `${relationship.following ? '1' : '0'}:${relationship.connection.kind}:${relationship.connection.connectionId ?? ''}`
}

export function RelationshipControls({
  profileId,
  initialRelationship,
  compact = false,
  menuIconOnly = false,
  variant = 'default',
  reportProfile = false,
  openMenuEvent,
}: {
  profileId: string
  initialRelationship: RelationshipState
  compact?: boolean
  menuIconOnly?: boolean
  /** `profile`: the public profile header — on phones one wide pill button plus a round "…". */
  variant?: 'default' | 'profile'
  /** Adds "Report profile" to the phone "…" sheet (desktop keeps its separate Report button). */
  reportProfile?: boolean
  /** A window event name that opens the "…" menu, e.g. from the phone page bar's "…". */
  openMenuEvent?: string
}) {
  const router = useRouter()
  const canonicalRelationshipKey = relationshipStateKey(initialRelationship)
  const [lastCanonicalRelationshipKey, setLastCanonicalRelationshipKey] = useState(canonicalRelationshipKey)
  const [relationship, setRelationship] = useState(initialRelationship)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [awaitingRefresh, setAwaitingRefresh] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const menuTriggerRef = useRef<HTMLButtonElement | null>(null)

  useEffect(() => {
    if (!openMenuEvent) return
    const open = () => setMenuOpen(true)
    window.addEventListener(openMenuEvent, open)
    return () => window.removeEventListener(openMenuEvent, open)
  }, [openMenuEvent])

  if (lastCanonicalRelationshipKey !== canonicalRelationshipKey) {
    setLastCanonicalRelationshipKey(canonicalRelationshipKey)
    setRelationship(initialRelationship)
    setAwaitingRefresh(false)
  }

  function refreshAfterSuccess() {
    setAwaitingRefresh(true)
    router.refresh()
  }

  function toggleFollow() {
    const previous = relationship
    const next = { ...relationship, following: !relationship.following }
    setRelationship(next)
    setError('')
    startTransition(async () => {
      const result = next.following ? await followProfile(profileId) : await unfollowProfile(profileId)
      if (!result.ok) {
        setRelationship(previous)
        setError(result.error)
        return
      }
      refreshAfterSuccess()
    })
  }

  function connect() {
    const previous = relationship
    setRelationship({
      ...relationship,
      connection: { kind: 'outgoing_pending', connectionId: profileId },
    })
    setAwaitingRefresh(true)
    setError('')
    startTransition(async () => {
      const result = await sendConnectionRequest(profileId)
      if (!result.ok) {
        setRelationship(previous)
        setAwaitingRefresh(false)
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  function respond(action: 'accept' | 'decline' | 'cancel' | 'remove') {
    const connectionId = relationship.connection.connectionId
    if (!connectionId || awaitingRefresh) return

    const previous = relationship
    if (action === 'accept') {
      setRelationship({
        following: true,
        connection: { kind: 'connected', connectionId },
      })
    } else {
      setRelationship({ ...relationship, connection: { kind: 'none', connectionId: null } })
    }
    setError('')

    startTransition(async () => {
      const result = action === 'accept'
        ? await acceptConnectionRequest(connectionId)
        : action === 'decline'
          ? await declineConnectionRequest(connectionId)
          : action === 'cancel'
            ? await cancelConnectionRequest(connectionId)
            : await removeConnection(connectionId)

      if (!result.ok) {
        setRelationship(previous)
        setError(result.error)
        return
      }
      refreshAfterSuccess()
    })
  }

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

  const buttonClass = compact
    ? 'min-h-9 rounded-xl border border-mist-200 bg-white px-3 text-xs font-semibold text-navy-900 transition-colors hover:border-ocean-500 hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-50'
    : 'min-h-10 rounded-xl border border-mist-200 bg-white px-3.5 text-sm font-semibold text-navy-900 transition-colors hover:border-ocean-500 hover:bg-mist-50 disabled:cursor-not-allowed disabled:opacity-50'
  const profileVariant = variant === 'profile'
  // Merged with cn() so the filled tone replaces the outline tone: Tailwind orders same-property
  // utilities by name, so a plain string concat would leave bg-white and text-white both applied.
  const primaryClass = cn(buttonClass, 'border-navy-950 bg-navy-950 text-white hover:border-navy-800 hover:bg-navy-800', profileVariant && PHONE_PRIMARY_PILL)
  const menuItemClass = 'text-xs text-navy-900'
  const phoneIcon = 'size-5 shrink-0 md:hidden'

  return (
    <div className="space-y-2">
      <div className={`flex flex-wrap items-center gap-2 ${profileVariant ? 'max-md:flex-nowrap' : ''}`}>
        {relationship.connection.kind === 'none' ? (
          <button type="button" disabled={pending} onClick={connect} className={primaryClass}>
            {profileVariant ? <UserPlus aria-hidden="true" className={phoneIcon} /> : null}
            Connect
          </button>
        ) : null}

        {relationship.connection.kind === 'outgoing_pending' ? (
          <span className={`inline-flex min-h-9 items-center rounded-xl bg-mist-50 px-3 text-xs font-semibold text-muted ${profileVariant ? PHONE_PENDING_PILL : ''}`}>
            {profileVariant ? <Clock3 aria-hidden="true" className={phoneIcon} /> : null}<span>Pending</span></span>
        ) : null}

        {relationship.connection.kind === 'incoming_pending' ? (
          <button type="button" disabled={pending} onClick={() => respond('accept')} className={primaryClass}>
            {profileVariant ? <Check aria-hidden="true" className={phoneIcon} /> : null}
            Accept
          </button>
        ) : null}

        {relationship.connection.kind === 'connected' ? (
          <div className={profileVariant ? 'max-md:min-w-0 max-md:flex-1' : 'contents'}>
            <StartConversationButton targetProfileId={profileId} className={`${compact ? 'min-h-9 px-3 text-xs' : ''} ${profileVariant ? PHONE_MESSAGE_PILL : ''} ${compact && menuIconOnly ? PHONE_MESSAGE_ICON : ''}`.trim()} />
          </div>
        ) : null}

        <button
          ref={menuTriggerRef}
          type="button"
          aria-label={menuIconOnly ? 'More actions' : 'More'}
          aria-expanded={menuOpen}
          aria-haspopup="menu"
          onClick={() => setMenuOpen((value) => !value)}
          className={menuIconOnly
            ? 'grid size-9 shrink-0 place-items-center rounded-full text-navy-900 transition hover:bg-mist-50 max-md:size-11 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500'
            : `${buttonClass} inline-flex items-center ${profileVariant ? PHONE_MORE_ROUND : ''}`}
        >
          {menuIconOnly ? <Ellipsis aria-hidden="true" className="size-5" /> : profileVariant ? (
            <>
              <span className="max-md:sr-only">More</span>
              <Ellipsis aria-hidden="true" className={phoneIcon} />
            </>
          ) : 'More'}
        </button>
        {/* Rendered in a portal, so the last row of a list is never clipped by its card. */}
        <ActionMenu open={menuOpen} onClose={() => setMenuOpen(false)} anchorRef={menuTriggerRef} label="Relationship actions">
          <ActionMenuItem
            disabled={pending}
            onClick={() => {
              setMenuOpen(false)
              toggleFollow()
            }}
            className={menuItemClass}
            icon={relationship.following ? <UserRoundCheck aria-hidden="true" className={phoneIcon} /> : <UserRoundPlus aria-hidden="true" className={phoneIcon} />}
          >
            {relationship.following ? 'Following' : 'Follow'}
          </ActionMenuItem>
          {relationship.connection.kind === 'outgoing_pending' ? (
            <ActionMenuItem
              disabled={pending || awaitingRefresh}
              onClick={() => {
                setMenuOpen(false)
                respond('cancel')
              }}
              className={menuItemClass}
              icon={<X aria-hidden="true" className={phoneIcon} />}
            >
              Cancel request
            </ActionMenuItem>
          ) : null}
          {relationship.connection.kind === 'incoming_pending' ? (
            <ActionMenuItem
              disabled={pending || awaitingRefresh}
              onClick={() => {
                setMenuOpen(false)
                respond('decline')
              }}
              className={menuItemClass}
              icon={<X aria-hidden="true" className={phoneIcon} />}
            >
              Decline
            </ActionMenuItem>
          ) : null}
          {relationship.connection.kind === 'connected' ? (
            <ActionMenuItem
              disabled={pending || awaitingRefresh}
              onClick={() => {
                setMenuOpen(false)
                respond('remove')
              }}
              className={menuItemClass}
              icon={<UserMinus aria-hidden="true" className={phoneIcon} />}
            >
              Remove connection
            </ActionMenuItem>
          ) : null}
          <ActionMenuItem
            tone="danger"
            disabled={pending}
            onClick={() => {
              setMenuOpen(false)
              block()
            }}
            className="text-xs"
            icon={<Ban aria-hidden="true" className={phoneIcon} />}
          >
            Block
          </ActionMenuItem>
          {reportProfile ? (
            <ActionMenuItem
              tone="danger"
              onClick={() => {
                setMenuOpen(false)
                setReporting(true)
              }}
              className="text-xs md:hidden"
              icon={<Flag aria-hidden="true" className={phoneIcon} />}
            >
              Report profile
            </ActionMenuItem>
          ) : null}
        </ActionMenu>
      </div>
      {reporting ? (
        <ReportContentButton
          targetType="profile"
          targetId={profileId}
          label="Report profile"
          hideTrigger
          defaultOpen
          onClose={() => setReporting(false)}
        />
      ) : null}
      {error ? <p role="alert" className="text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  )
}

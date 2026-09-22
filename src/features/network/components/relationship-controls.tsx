'use client'

import { useState, useTransition } from 'react'
import { Ellipsis } from 'lucide-react'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'
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

function relationshipStateKey(relationship: RelationshipState) {
  return `${relationship.following ? '1' : '0'}:${relationship.connection.kind}:${relationship.connection.connectionId ?? ''}`
}

export function RelationshipControls({
  profileId,
  initialRelationship,
  compact = false,
  menuIconOnly = false,
}: {
  profileId: string
  initialRelationship: RelationshipState
  compact?: boolean
  menuIconOnly?: boolean
}) {
  const router = useRouter()
  const canonicalRelationshipKey = relationshipStateKey(initialRelationship)
  const [lastCanonicalRelationshipKey, setLastCanonicalRelationshipKey] = useState(canonicalRelationshipKey)
  const [relationship, setRelationship] = useState(initialRelationship)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [awaitingRefresh, setAwaitingRefresh] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useDismissibleLayer<HTMLDivElement>(menuOpen, () => setMenuOpen(false))

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
    ? 'min-h-9 rounded-xl border border-mist-100 px-3 text-xs font-semibold text-navy-900 hover:border-ocean-500 disabled:opacity-50'
    : 'min-h-10 rounded-xl border border-mist-100 px-3.5 text-sm font-semibold text-navy-900 hover:border-ocean-500 disabled:opacity-50'
  const primaryClass = `${buttonClass} border-navy-950 bg-navy-950 text-white hover:border-navy-900`
  const menuItemClass = 'min-h-9 w-full rounded-lg px-3 text-left text-xs font-semibold text-navy-900 hover:bg-mist-50 disabled:opacity-50'

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {relationship.connection.kind === 'none' ? (
          <button type="button" disabled={pending} onClick={connect} className={primaryClass}>Connect</button>
        ) : null}

        {relationship.connection.kind === 'outgoing_pending' ? (
          <span className="inline-flex min-h-9 items-center rounded-xl bg-mist-50 px-3 text-xs font-semibold text-muted">Pending</span>
        ) : null}

        {relationship.connection.kind === 'incoming_pending' ? (
          <button type="button" disabled={pending} onClick={() => respond('accept')} className={primaryClass}>Accept</button>
        ) : null}

        {relationship.connection.kind === 'connected' ? (
          <StartConversationButton targetProfileId={profileId} className={compact ? 'min-h-9 px-3 text-xs' : ''} />
        ) : null}

        <div ref={menuRef} className="relative">
          <button
            type="button"
            aria-label={menuIconOnly ? 'More actions' : 'More'}
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            onClick={() => setMenuOpen((value) => !value)}
            className={menuIconOnly
              ? 'grid size-9 place-items-center rounded-full text-navy-900 transition hover:bg-mist-50'
              : `${buttonClass} inline-flex items-center`}
          >
            {menuIconOnly ? <Ellipsis aria-hidden="true" className="size-5" /> : 'More'}
          </button>
          {menuOpen ? (
            <div role="menu" aria-label="Relationship actions" className="absolute right-0 z-[70] mt-2 min-w-48 rounded-xl border border-mist-100 bg-white p-1.5 shadow-xl">
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                onClick={() => {
                  setMenuOpen(false)
                  toggleFollow()
                }}
                className={menuItemClass}
              >
                {relationship.following ? 'Following' : 'Follow'}
              </button>
              {relationship.connection.kind === 'outgoing_pending' ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={pending || awaitingRefresh}
                  onClick={() => {
                    setMenuOpen(false)
                    respond('cancel')
                  }}
                  className={menuItemClass}
                >
                  Cancel request
                </button>
              ) : null}
              {relationship.connection.kind === 'incoming_pending' ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={pending || awaitingRefresh}
                  onClick={() => {
                    setMenuOpen(false)
                    respond('decline')
                  }}
                  className={menuItemClass}
                >
                  Decline
                </button>
              ) : null}
              {relationship.connection.kind === 'connected' ? (
                <button
                  type="button"
                  role="menuitem"
                  disabled={pending || awaitingRefresh}
                  onClick={() => {
                    setMenuOpen(false)
                    respond('remove')
                  }}
                  className={menuItemClass}
                >
                  Remove connection
                </button>
              ) : null}
              <button
                type="button"
                role="menuitem"
                disabled={pending}
                onClick={() => {
                  setMenuOpen(false)
                  block()
                }}
                className="min-h-9 w-full rounded-lg px-3 text-left text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                Block
              </button>
            </div>
          ) : null}
        </div>
      </div>
      {error ? <p role="alert" className="text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  )
}

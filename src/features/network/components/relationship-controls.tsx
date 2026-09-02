'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
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

export function RelationshipControls({
  profileId,
  initialRelationship,
  compact = false,
}: {
  profileId: string
  initialRelationship: RelationshipState
  compact?: boolean
}) {
  const router = useRouter()
  const [relationship, setRelationship] = useState(initialRelationship)
  const [error, setError] = useState('')
  const [pending, startTransition] = useTransition()
  const [awaitingRefresh, setAwaitingRefresh] = useState(false)

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

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={pending} onClick={toggleFollow} className={relationship.following ? buttonClass : primaryClass}>
          {relationship.following ? 'Following' : 'Follow'}
        </button>

        {relationship.connection.kind === 'none' ? (
          <button type="button" disabled={pending} onClick={connect} className={buttonClass}>Connect</button>
        ) : null}

        {relationship.connection.kind === 'outgoing_pending' ? (
          <>
            <span className="inline-flex min-h-9 items-center rounded-xl bg-mist-50 px-3 text-xs font-semibold text-muted">Pending</span>
            <button type="button" disabled={pending || awaitingRefresh} onClick={() => respond('cancel')} className={buttonClass}>Cancel</button>
          </>
        ) : null}

        {relationship.connection.kind === 'incoming_pending' ? (
          <>
            <button type="button" disabled={pending} onClick={() => respond('accept')} className={primaryClass}>Accept</button>
            <button type="button" disabled={pending} onClick={() => respond('decline')} className={buttonClass}>Decline</button>
          </>
        ) : null}

        {relationship.connection.kind === 'connected' ? (
          <>
            <span className="inline-flex min-h-9 items-center rounded-xl bg-mist-50 px-3 text-xs font-semibold text-ocean-700">Connected</span>
            <button type="button" disabled={pending} onClick={() => respond('remove')} className={buttonClass}>Remove</button>
          </>
        ) : null}

        <details className="relative">
          <summary className={`${buttonClass} inline-flex cursor-pointer list-none items-center`}>More</summary>
          <div className="absolute right-0 z-20 mt-1 min-w-32 rounded-xl border border-mist-100 bg-white p-1 shadow-lg">
            <button type="button" disabled={pending} onClick={block} className="min-h-9 w-full rounded-lg px-3 text-left text-xs font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50">
              Block
            </button>
          </div>
        </details>
      </div>
      {error ? <p role="alert" className="text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  )
}

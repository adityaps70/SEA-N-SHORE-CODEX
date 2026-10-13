'use client'

import { useState, useTransition } from 'react'
import { UserPlus } from 'lucide-react'
import { StartConversationButton } from '@/features/messaging/components/start-conversation-button'
import {
  acceptConnectionRequest,
  sendConnectionRequest,
} from '../actions'
import type { RelationshipState } from '../types'

export function ConnectionPrimaryAction({
  profileId,
  initialRelationship,
  className = '',
  variant = 'block',
  onConnect,
  externalError = '',
  fullName,
}: {
  profileId: string
  initialRelationship: RelationshipState
  className?: string
  /** `pill`: one compact ocean outline pill (Connect, Pending, Accept or Message) for list rows. */
  variant?: 'block' | 'pill'
  /** Suggestion decks own the request: Connect calls this, which replaces the card at once. */
  onConnect?: () => void
  /** An error the deck reports after a refused request (the card is back). */
  externalError?: string
  /** Names the member in the Connect button's accessible name ("Connect with …") in lists of cards. */
  fullName?: string
}) {
  const [relationship, setRelationship] = useState(initialRelationship)
  const [pending, startTransition] = useTransition()
  const [ownError, setError] = useState('')
  const error = ownError || externalError

  function sendRequest() {
    if (onConnect) {
      onConnect()
      return
    }
    const previous = relationship
    setRelationship({ ...relationship, connection: { kind: 'outgoing_pending', connectionId: profileId } })
    setError('')
    startTransition(async () => {
      const result = await sendConnectionRequest(profileId)
      if (!result.ok) {
        setRelationship(previous)
        setError(result.error)
      }
    })
  }

  function acceptRequest() {
    const connectionId = relationship.connection.connectionId
    if (!connectionId) return
    const previous = relationship
    setRelationship({ following: true, connection: { kind: 'connected', connectionId } })
    setError('')
    startTransition(async () => {
      const result = await acceptConnectionRequest(connectionId)
      if (!result.ok) {
        setRelationship(previous)
        setError(result.error)
      }
    })
  }

  const buttonClass = variant === 'pill'
    ? `relative inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-full border border-ocean-700 bg-white px-3.5 text-[13px] font-semibold text-ocean-700 transition before:absolute before:inset-x-0 before:-inset-y-1 before:content-[''] hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 disabled:cursor-not-allowed disabled:opacity-60 ${className}`
    : `inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-ocean-600 px-4 text-sm font-semibold text-ocean-700 transition hover:bg-ocean-50 disabled:cursor-not-allowed disabled:opacity-60 ${className}`

  return (
    <div className="space-y-1.5">
      {relationship.connection.kind === 'none' ? (
        <button type="button" disabled={pending} onClick={sendRequest} className={buttonClass} data-suggestion-connect={onConnect ? '' : undefined} aria-label={fullName ? `Connect with ${fullName}` : undefined}>
          {variant === 'pill' ? null : <UserPlus aria-hidden="true" className="size-4" />}
          Connect
        </button>
      ) : null}

      {relationship.connection.kind === 'outgoing_pending' ? (
        <button type="button" disabled className={buttonClass}>Pending</button>
      ) : null}

      {relationship.connection.kind === 'incoming_pending' ? (
        <button type="button" disabled={pending} onClick={acceptRequest} className={buttonClass}>Accept</button>
      ) : null}

      {relationship.connection.kind === 'connected' ? (
        variant === 'pill'
          ? <StartConversationButton targetProfileId={profileId} variant="pill" />
          : <StartConversationButton targetProfileId={profileId} className="w-full rounded-full" />
      ) : null}

      {error ? <p role="alert" className={`text-center text-xs font-medium text-red-700 ${variant === 'pill' ? 'max-w-40' : ''}`}>{error}</p> : null}
    </div>
  )
}

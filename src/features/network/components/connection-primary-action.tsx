'use client'

import { useState, useTransition } from 'react'
import { UserPlus } from 'lucide-react'
import { useRouter } from 'next/navigation'
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
}: {
  profileId: string
  initialRelationship: RelationshipState
  className?: string
}) {
  const router = useRouter()
  const [relationship, setRelationship] = useState(initialRelationship)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState('')

  function sendRequest() {
    const previous = relationship
    setRelationship({ ...relationship, connection: { kind: 'outgoing_pending', connectionId: profileId } })
    setError('')
    startTransition(async () => {
      const result = await sendConnectionRequest(profileId)
      if (!result.ok) {
        setRelationship(previous)
        setError(result.error)
        return
      }
      router.refresh()
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
        return
      }
      router.refresh()
    })
  }

  const buttonClass = `inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-full border border-ocean-600 px-4 text-sm font-semibold text-ocean-700 transition hover:bg-ocean-50 disabled:cursor-not-allowed disabled:opacity-60 ${className}`

  return (
    <div className="space-y-1.5">
      {relationship.connection.kind === 'none' ? (
        <button type="button" disabled={pending} onClick={sendRequest} className={buttonClass}>
          <UserPlus aria-hidden="true" className="size-4" />
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
        <StartConversationButton targetProfileId={profileId} className="w-full rounded-full" />
      ) : null}

      {error ? <p role="alert" className="text-center text-xs font-medium text-red-700">{error}</p> : null}
    </div>
  )
}

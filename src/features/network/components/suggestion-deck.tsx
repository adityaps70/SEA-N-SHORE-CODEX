'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react'
import { dismissSuggestionAction } from '@/features/signals/actions'
import { sendConnectionRequest } from '../actions'
import type { NetworkProfile } from '../types'

/** Organisation pages never belong in People you may know, whatever the server returned. */
export function isPersonSuggestion(profile: NetworkProfile) {
  return profile.identityRoot !== 'organisation' && profile.profileType !== 'company'
}

export type SuggestionDeck = {
  /** People still to show, in the server's order: removed cards are gone and spares move up. */
  remaining: NetworkProfile[]
  /** Errors from a refused Connect, by profile id; the card is back in its place. */
  errors: Readonly<Record<string, string>>
  /** A polite screen-reader message about the last change. */
  announcement: string
  /** Sends a request and replaces the card at once; a refusal brings the card back with an error. */
  connect(profile: NetworkProfile): void
  /** Hides the card for this visit and slides the next person in. */
  dismiss(profile: NetworkProfile): void
  /** The card that was just removed (its index; seq changes on every removal), so focus can move to its replacement. */
  focusRequest: { index: number; seq: number } | null
  pending: boolean
}

/**
 * Round G hotfix: one list of suggestions (the cards shown plus spares) with optimistic Connect.
 * The server excludes connections, pending requests, follows and blocks, and revalidates the page
 * after a request; until then this deck keeps the person out of every card it renders.
 */
export function useSuggestionDeck(profiles: readonly NetworkProfile[]): SuggestionDeck {
  const [removed, setRemoved] = useState<ReadonlySet<string>>(() => new Set())
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({})
  const [announcement, setAnnouncement] = useState('')
  const [focusRequest, setFocusRequest] = useState<{ index: number; seq: number } | null>(null)
  const [pending, startTransition] = useTransition()

  const remaining = useMemo(
    () => profiles.filter((profile) => isPersonSuggestion(profile) && !removed.has(profile.id)),
    [profiles, removed],
  )

  const remove = useCallback((profile: NetworkProfile) => {
    const index = Math.max(remaining.findIndex((item) => item.id === profile.id), 0)
    setFocusRequest((current) => ({ index, seq: (current?.seq ?? 0) + 1 }))
    setRemoved((current) => new Set(current).add(profile.id))
    setErrors((current) => {
      if (!(profile.id in current)) return current
      const next = { ...current }
      delete next[profile.id]
      return next
    })
  }, [remaining])

  const connect = useCallback((profile: NetworkProfile) => {
    remove(profile)
    setAnnouncement(`Connection request sent to ${profile.fullName}.`)
    startTransition(async () => {
      const result = await sendConnectionRequest(profile.id)
      if (result.ok) return
      setRemoved((current) => {
        const next = new Set(current)
        next.delete(profile.id)
        return next
      })
      setErrors((current) => ({ ...current, [profile.id]: result.error }))
      setAnnouncement(`We could not send the request to ${profile.fullName}. ${result.error}`)
    })
  }, [remove])

  /** The X: hidden for 180 days (round G); the card slides out at once and comes back if saving fails. */
  const dismiss = useCallback((profile: NetworkProfile) => {
    remove(profile)
    setAnnouncement(`${profile.fullName} removed from your suggestions.`)
    startTransition(async () => {
      const result = await dismissSuggestionAction('person', profile.id)
      if (result.ok) return
      setRemoved((current) => {
        const next = new Set(current)
        next.delete(profile.id)
        return next
      })
      setErrors((current) => ({ ...current, [profile.id]: result.error }))
    })
  }, [remove])

  return { remaining, errors, announcement, connect, dismiss, focusRequest, pending }
}

/**
 * After a card leaves, keyboard focus would fall back to the page. This moves it to the Connect
 * button that took the removed card's place (or the empty state) inside `container`.
 */
export function focusReplacement(container: HTMLElement | null, request: SuggestionDeck['focusRequest']) {
  if (!container || !request) return
  const { index } = request
  const buttons = container.querySelectorAll<HTMLElement>('[data-suggestion-connect]')
  const target = buttons[Math.min(index, buttons.length - 1)]
    ?? container.querySelector<HTMLElement>('[data-suggestions-empty]')
  target?.focus({ preventScroll: true })
}

/** Moves focus to the replacement card after each removal (never on first render). */
export function useFocusReplacement(deck: SuggestionDeck) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const { focusRequest } = deck
  useEffect(() => {
    focusReplacement(containerRef.current, focusRequest)
  }, [focusRequest])
  return containerRef
}

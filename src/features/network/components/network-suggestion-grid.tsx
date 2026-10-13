'use client'

import type { NetworkProfile } from '../types'
import { NetworkProfileCard } from './network-profile-card'
import { useFocusReplacement, useSuggestionDeck } from './suggestion-deck'
import { SuggestionsEmptyState } from './suggestions-empty-state'

/** /network Discover shows this many cards; the rest of the list slides in after Connect or X. */
export const NETWORK_DISCOVER_VISIBLE = 30

/** Round G hotfix: the Discover grid of People you may know, with instant replacement and an empty state. */
export function NetworkSuggestionGrid({
  profiles,
  visibleCount = NETWORK_DISCOVER_VISIBLE,
  showEmptyState = true,
}: {
  profiles: NetworkProfile[]
  /** Cards shown at once (a Discover section shows 4); the rest are spares. */
  visibleCount?: number
  /** Sections render nothing once empty; the main grid shows the "seen everyone" state. */
  showEmptyState?: boolean
}) {
  const deck = useSuggestionDeck(profiles)
  const containerRef = useFocusReplacement(deck)
  const visible = deck.remaining.slice(0, visibleCount)
  if (!visible.length && !showEmptyState) return null

  return (
    <div ref={containerRef}>
      {visible.length ? (
        <div data-testid="network-suggestion-grid" className="grid gap-4 p-4 max-md:grid-cols-2 max-md:gap-2 max-md:px-3 max-md:pb-4 max-md:pt-0 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((profile) => (
            <NetworkProfileCard
              key={profile.id}
              profile={profile}
              onConnect={() => deck.connect(profile)}
              onDismiss={() => deck.dismiss(profile)}
              connectError={deck.errors[profile.id]}
            />
          ))}
        </div>
      ) : (
        <SuggestionsEmptyState />
      )}
      <p className="sr-only" aria-live="polite">{deck.announcement}</p>
    </div>
  )
}

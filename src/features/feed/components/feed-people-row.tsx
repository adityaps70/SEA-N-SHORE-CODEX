'use client'

import { MediaImage } from '@/components/ui/media-image'
import Link from '@/components/navigation/intent-link'
import { useId } from 'react'
import { X } from 'lucide-react'
import { ConnectionPrimaryAction } from '@/features/network/components/connection-primary-action'
import type { NetworkProfile } from '@/features/network/types'
import {
  isPersonSuggestion,
  useFocusReplacement,
  useSuggestionDeck,
  type SuggestionDeck,
} from '@/features/network/components/suggestion-deck'
import { SuggestionsEmptyState } from '@/features/network/components/suggestions-empty-state'

/** A phone "People you may know" row is inserted after every this many posts. */
export const FEED_PEOPLE_ROW_INTERVAL = 8

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

export { isPersonSuggestion }

/**
 * Positions (0-based post indexes) after which the phone suggestions row goes: after every
 * FEED_PEOPLE_ROW_INTERVAL posts, or after the last post when the feed is shorter than that.
 */
export function peopleRowPositions(postCount: number, interval = FEED_PEOPLE_ROW_INTERVAL) {
  if (postCount <= 0) return new Set<number>()
  if (postCount < interval) return new Set([postCount - 1])
  const positions = new Set<number>()
  for (let index = interval - 1; index < postCount; index += interval) positions.add(index)
  return positions
}

/** The phone row shows up to this many people; the rest of the list slides in after Connect. */
export const FEED_PEOPLE_ROW_VISIBLE = 10

/**
 * Phone-only horizontal swipe row of connection suggestions inside the feed. Uses the same
 * suggestions as the desktop right rail, which is hidden below xl; this row is hidden from md.
 * FeedList passes one shared `deck`, so a person connected in one row leaves every row at once.
 * `showEmptyState`: the first row says when nobody is left; later rows then render nothing.
 */
export function FeedPeopleRow({
  profiles = [],
  deck,
  showEmptyState = false,
}: {
  profiles?: NetworkProfile[]
  deck?: SuggestionDeck
  showEmptyState?: boolean
}) {
  return deck
    ? <PeopleRow deck={deck} showEmptyState={showEmptyState} />
    : <StandalonePeopleRow profiles={profiles} showEmptyState={showEmptyState} />
}

function StandalonePeopleRow({ profiles, showEmptyState }: { profiles: NetworkProfile[]; showEmptyState: boolean }) {
  const deck = useSuggestionDeck(profiles)
  return <PeopleRow deck={deck} showEmptyState={showEmptyState} />
}

function PeopleRow({ deck, showEmptyState }: { deck: SuggestionDeck; showEmptyState: boolean }) {
  const containerRef = useFocusReplacement(deck)
  // Several rows can be in the feed at once, so each heading gets its own id.
  const titleId = `feed-people-row-title-${useId().replace(/:/g, '')}`
  const people = deck.remaining.slice(0, FEED_PEOPLE_ROW_VISIBLE)
  if (!people.length && !showEmptyState) return null

  return (
    <section aria-labelledby={titleId} data-testid="feed-people-row" className="bg-white py-3 md:hidden">
      <div className="flex items-center justify-between gap-3 px-4">
        <h2 id={titleId} className="text-[15px] font-semibold text-navy-950">People you may know</h2>
        <Link
          href="/network"
          className="inline-flex min-h-11 items-center rounded-full px-2 text-sm font-semibold text-ocean-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
        >
          See all
        </Link>
      </div>
      <div ref={containerRef}>
        {people.length ? (
          <ul className="flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-1 pt-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {people.map((person) => {
              const role = person.rank ?? person.headline ?? 'Maritime professional'
              const personInitials = (
                <span aria-hidden="true" className="grid size-16 place-items-center rounded-full bg-mist-100 text-base font-semibold text-navy-950">
                  {initials(person.fullName)}
                </span>
              )
              return (
                <li key={person.id} className="w-40 shrink-0 snap-start">
                  <article className="relative flex h-full flex-col items-center rounded-2xl border border-mist-200 bg-white p-3 text-center">
                    <button
                      type="button"
                      onClick={() => deck.dismiss(person)}
                      aria-label={`Dismiss ${person.fullName} suggestion`}
                      className="absolute right-1 top-1 grid size-9 place-items-center rounded-full text-muted hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                    <Link
                      href={`/people/${person.slug}`}
                      className="flex w-full flex-col items-center rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
                    >
                      {person.avatarUrl ? (
                        <MediaImage avatar src={person.avatarUrl} alt="" width={64} height={64} sizes="64px" className="size-16 rounded-full object-cover ring-1 ring-mist-100" fallback={personInitials} />
                      ) : personInitials}
                      <span className="mt-2 block w-full truncate text-sm font-semibold text-navy-950">{person.fullName}</span>
                      <span className="mt-0.5 line-clamp-2 min-h-8 w-full text-xs leading-4 text-muted">{role}</span>
                      {person.suggestionReason ? <span className="mt-0.5 line-clamp-1 w-full text-xs font-medium leading-4 text-ocean-700">{person.suggestionReason}</span> : null}
                    </Link>
                    <div className="mt-2 w-full">
                      <ConnectionPrimaryAction
                        profileId={person.id}
                        initialRelationship={person.relationship}
                        className="min-h-9"
                        fullName={person.fullName}
                        onConnect={() => deck.connect(person)}
                        externalError={deck.errors[person.id]}
                      />
                    </div>
                  </article>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="px-4">
            <SuggestionsEmptyState compact />
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">{deck.announcement}</p>
    </section>
  )
}

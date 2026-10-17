'use client'

import { MediaImage } from '@/components/ui/media-image'
import Link from '@/components/navigation/intent-link'
import { useMemo } from 'react'
import { ArrowUpRight, X } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { NetworkProfile } from '../types'
import { ConnectionPrimaryAction } from './connection-primary-action'
import { useFocusReplacement, useSuggestionDeck } from './suggestion-deck'
import { SuggestionsEmptyState } from './suggestions-empty-state'

/** The rail shows this many people; the rest of the list are spares that slide in after Connect. */
export const PEOPLE_RAIL_VISIBLE = 3

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

export function PeopleYouMayKnow({
  profiles,
  excludeProfileId,
  title = 'People you may know',
  emptyState = true,
}: {
  profiles: NetworkProfile[]
  /** The profile on screen (a member's page), which should not suggest itself. */
  excludeProfileId?: string
  /** Round G: the same card lists "People similar to <name>" on a member's profile. */
  title?: string
  /** Lists other than People you may know render nothing when empty. */
  emptyState?: boolean
}) {
  const candidates = useMemo(
    () => (excludeProfileId ? profiles.filter((profile) => profile.id !== excludeProfileId) : profiles),
    [excludeProfileId, profiles],
  )
  const deck = useSuggestionDeck(candidates)
  const containerRef = useFocusReplacement(deck)
  const visibleProfiles = deck.remaining.slice(0, PEOPLE_RAIL_VISIBLE)
  if (!visibleProfiles.length && !emptyState) return null

  return (
    <Card className="border border-mist-100 p-4">
      <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Professional network</p>
      <h2 className="mt-1 text-lg font-semibold text-navy-950">{title}</h2>
      <div ref={containerRef}>
        {visibleProfiles.length ? (
          <ul aria-label={title} className="mt-3 divide-y divide-mist-100">
            {visibleProfiles.map((profile) => {
              const identityLine = profile.summary ?? profile.headline ?? ([profile.rank, profile.currentCompany].filter(Boolean).join(' · ') || 'Maritime professional')
              const profileInitials = (
                <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-mist-100 text-xs font-semibold text-navy-950">
                  {initials(profile.fullName)}
                </div>
              )
              return (
                <li key={profile.id} data-testid="people-you-may-know-card" className="py-3 first:pt-1 last:pb-1">
                  <div className="flex items-start gap-3">
                    {profile.avatarUrl ? (
                      <MediaImage avatar src={profile.avatarUrl} alt={`${profile.fullName} profile`} width={44} height={44} sizes="44px" className="size-11 shrink-0 rounded-xl object-cover ring-1 ring-mist-100" fallback={profileInitials} />
                    ) : profileInitials}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-navy-950">{profile.fullName}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted">{identityLine}</p>
                      {profile.suggestionReason ? <p className="mt-0.5 truncate text-xs font-medium text-ocean-700">{profile.suggestionReason}</p> : null}
                    </div>
                    <button
                      type="button"
                      onClick={() => deck.dismiss(profile)}
                      aria-label={`Dismiss ${profile.fullName} suggestion`}
                      className="-mr-1 -mt-1 grid size-9 shrink-0 place-items-center rounded-full text-muted hover:bg-mist-50 hover:text-navy-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
                    >
                      <X aria-hidden="true" className="size-4" />
                    </button>
                  </div>
                  <div className="mt-2 ml-14 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <ConnectionPrimaryAction
                      profileId={profile.id}
                      initialRelationship={profile.relationship}
                      variant="pill"
                      fullName={profile.fullName}
                      onConnect={() => deck.connect(profile)}
                      externalError={deck.errors[profile.id]}
                    />
                    <Link href={`/people/${profile.slug}`} aria-label={`View profile: ${profile.fullName}`} className="inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-ocean-700 hover:text-navy-950">
                      View profile <ArrowUpRight aria-hidden="true" className="size-3.5" />
                    </Link>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <div className="mt-2">
            <SuggestionsEmptyState compact />
          </div>
        )}
      </div>
      <p className="sr-only" aria-live="polite">{deck.announcement}</p>
    </Card>
  )
}

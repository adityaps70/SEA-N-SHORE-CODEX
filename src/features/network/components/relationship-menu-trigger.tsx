'use client'

import { Ellipsis } from 'lucide-react'
import { relationshipMenuEventName } from './relationship-menu-event'

/** The phone page bar's "…" on a public profile: opens the same sheet as the header's "…". */
export function RelationshipMenuTrigger({ profileId, label }: { profileId: string; label: string }) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-haspopup="menu"
      onClick={() => window.dispatchEvent(new Event(relationshipMenuEventName(profileId)))}
      className="grid size-11 cursor-pointer place-items-center rounded-full text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
    >
      <Ellipsis aria-hidden="true" className="size-6" />
    </button>
  )
}

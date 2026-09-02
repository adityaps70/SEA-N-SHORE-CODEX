import Link from 'next/link'
import { ArrowUpRight, Clock3, MapPin, Ship } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { NetworkProfile } from '../types'
import { RelationshipControls } from './relationship-controls'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

export function ConnectionRequestCard({
  profile,
  direction,
}: {
  profile: NetworkProfile
  direction: 'incoming' | 'sent'
}) {
  const relationshipKey = `${profile.relationship.following ? 1 : 0}:${profile.relationship.connection.kind}:${profile.relationship.connection.connectionId ?? ''}`

  return (
    <Card className="border border-mist-100 p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-mist-100 text-sm font-semibold text-navy-950">{initials(profile.fullName)}</div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-navy-950">{profile.fullName}</h2>
            <span className="inline-flex items-center gap-1 rounded-full bg-mist-50 px-2 py-1 text-[11px] font-semibold text-ocean-700">
              <Clock3 aria-hidden="true" className="size-3" />
              {direction === 'incoming' ? 'Wants to connect' : 'Request sent'}
            </span>
          </div>
          {profile.headline ? <p className="mt-1 text-sm leading-5 text-muted">{profile.headline}</p> : null}
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted">
        {profile.location ? <span className="inline-flex items-center gap-1.5"><MapPin aria-hidden="true" className="size-4" />{profile.location}</span> : null}
        {profile.rank || profile.currentCompany ? <span className="inline-flex items-center gap-1.5"><Ship aria-hidden="true" className="size-4" />{[profile.rank, profile.currentCompany].filter(Boolean).join(' · ')}</span> : null}
      </div>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <RelationshipControls key={relationshipKey} profileId={profile.id} initialRelationship={profile.relationship} compact />
        <Link href={`/people/${profile.slug}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-ocean-700 hover:text-navy-950">
          View profile
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </Card>
  )
}

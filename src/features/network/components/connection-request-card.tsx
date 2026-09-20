import Link from 'next/link'
import { Clock3, MapPin, Ship } from 'lucide-react'
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
    <article className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:px-6">
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <Link href={`/people/${profile.slug}`} className="shrink-0" aria-label={`View ${profile.fullName} profile photo`}>
          {profile.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- profile media is a short-lived external signed URL
            <img src={profile.avatarUrl} alt={`${profile.fullName} profile`} loading="lazy" className="size-16 rounded-full object-cover ring-1 ring-mist-100" />
          ) : (
            <span className="grid size-16 place-items-center rounded-full bg-mist-100 text-sm font-semibold text-navy-950 ring-1 ring-mist-100">
              {initials(profile.fullName)}
            </span>
          )}
        </Link>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/people/${profile.slug}`} className="font-semibold text-navy-950 hover:text-ocean-700">
              {profile.fullName}
            </Link>
            <span className="inline-flex items-center gap-1 rounded-full bg-mist-50 px-2 py-1 text-[11px] font-semibold text-ocean-700">
              <Clock3 aria-hidden="true" className="size-3" />
              {direction === 'incoming' ? 'Wants to connect' : 'Request sent'}
            </span>
          </div>
          {profile.headline ? <p className="mt-1 line-clamp-2 text-sm leading-5 text-ink">{profile.headline}</p> : null}
          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {profile.location ? <span className="inline-flex items-center gap-1"><MapPin aria-hidden="true" className="size-3.5" />{profile.location}</span> : null}
            {profile.rank || profile.currentCompany ? (
              <span className="inline-flex items-center gap-1"><Ship aria-hidden="true" className="size-3.5" />{[profile.rank, profile.currentCompany].filter(Boolean).join(' · ')}</span>
            ) : null}
          </div>
        </div>
      </div>

      <div className="shrink-0 pl-20 sm:pl-0">
        <RelationshipControls
          key={relationshipKey}
          profileId={profile.id}
          initialRelationship={profile.relationship}
          compact
          menuIconOnly
        />
      </div>
    </article>
  )
}

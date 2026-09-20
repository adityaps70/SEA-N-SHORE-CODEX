import Link from 'next/link'
import type { NetworkProfile } from '../types'
import { FollowToggleButton } from './follow-toggle-button'
import { RelationshipControls } from './relationship-controls'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

function formatConnectedDate(value: string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return new Intl.DateTimeFormat('en', { month: 'long', day: 'numeric', year: 'numeric' }).format(date)
}

export function NetworkPersonListRow({
  profile,
  kind,
}: {
  profile: NetworkProfile
  kind: 'connection' | 'following' | 'follower'
}) {
  const connectedOn = kind === 'connection' ? formatConnectedDate(profile.relationshipSince) : null

  return (
    <article className="flex items-center gap-4 px-5 py-4 sm:px-6">
      <Link href={`/people/${profile.slug}`} className="shrink-0" aria-label={profile.fullName}>
        {profile.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- profile media is a short-lived external signed URL
          <img
            src={profile.avatarUrl}
            alt=""
            loading="lazy"
            className="size-16 rounded-full object-cover ring-1 ring-mist-100"
          />
        ) : (
          <span className="grid size-16 place-items-center rounded-full bg-mist-100 text-sm font-semibold text-navy-950 ring-1 ring-mist-100">
            {initials(profile.fullName)}
          </span>
        )}
      </Link>

      <div className="min-w-0 flex-1">
        <Link href={`/people/${profile.slug}`} className="font-semibold text-navy-950 hover:text-ocean-700">
          {profile.fullName}
        </Link>
        <p className="mt-0.5 line-clamp-2 text-sm leading-5 text-ink">
          {profile.headline ?? [profile.rank, profile.currentCompany].filter(Boolean).join(' · ') ?? 'Maritime professional'}
        </p>
        {connectedOn ? <p className="mt-0.5 text-sm text-muted">Connected on {connectedOn}</p> : null}
        {kind !== 'connection' && profile.location ? <p className="mt-0.5 truncate text-xs text-muted">{profile.location}</p> : null}
      </div>

      <div className="shrink-0">
        {kind === 'connection' ? (
          <RelationshipControls
            profileId={profile.id}
            initialRelationship={profile.relationship}
            compact
            menuIconOnly
          />
        ) : (
          <FollowToggleButton
            profileId={profile.id}
            following={profile.relationship.following}
            followerView={kind === 'follower'}
          />
        )}
      </div>
    </article>
  )
}

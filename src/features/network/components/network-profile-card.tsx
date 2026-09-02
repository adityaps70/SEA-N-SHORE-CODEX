import Link from 'next/link'
import { ArrowUpRight, MapPin, Ship } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { NetworkProfile } from '../types'
import { RelationshipControls } from './relationship-controls'

const profileTypeLabels: Record<NetworkProfile['profileType'], string> = {
  seafarer: 'Seafarer',
  maritime_professional: 'Maritime Professional',
  company: 'Company',
  trainer: 'Trainer',
  mentor: 'Mentor',
  recruiter: 'Recruiter',
  service_provider: 'Service Provider',
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

export function NetworkProfileCard({ profile }: { profile: NetworkProfile }) {
  const relationshipKey = `${profile.relationship.following ? 1 : 0}:${profile.relationship.connection.kind}:${profile.relationship.connection.connectionId ?? ''}`

  return (
    <Card className="flex h-full flex-col border border-mist-100 p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[linear-gradient(145deg,var(--mist-100),white)] text-sm font-semibold text-navy-950 ring-1 ring-mist-100">
          {initials(profile.fullName)}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-[.11em] text-ocean-700">{profileTypeLabels[profile.profileType]}</p>
          <h2 className="mt-1 truncate text-lg font-semibold text-navy-950">{profile.fullName}</h2>
          {profile.headline ? <p className="mt-1 line-clamp-2 text-sm leading-5 text-muted">{profile.headline}</p> : null}
        </div>
      </div>

      <div className="mt-4 space-y-2 text-sm text-muted">
        {profile.location ? <p className="flex items-center gap-2"><MapPin aria-hidden="true" className="size-4 shrink-0" /><span className="truncate">{profile.location}</span></p> : null}
        {profile.rank || profile.currentCompany ? <p className="flex items-center gap-2"><Ship aria-hidden="true" className="size-4 shrink-0" /><span className="truncate">{[profile.rank, profile.currentCompany].filter(Boolean).join(' · ')}</span></p> : null}
      </div>

      {profile.skills.length ? (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {profile.skills.slice(0, 3).map((skill) => <span key={skill} className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-medium text-navy-900">{skill}</span>)}
          {profile.skills.length > 3 ? <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-medium text-muted">+{profile.skills.length - 3}</span> : null}
        </div>
      ) : null}

      <div className="mt-auto pt-5">
        <RelationshipControls key={relationshipKey} profileId={profile.id} initialRelationship={profile.relationship} />
        <Link href={`/people/${profile.slug}`} className="mt-3 inline-flex min-h-10 w-full items-center justify-between rounded-xl border border-mist-100 px-3 text-sm font-semibold text-navy-900 hover:border-ocean-500 hover:text-ocean-700">
          View professional profile
          <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </div>
    </Card>
  )
}

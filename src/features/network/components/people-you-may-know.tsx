import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { NetworkProfile } from '../types'
import { RelationshipControls } from './relationship-controls'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

export function PeopleYouMayKnow({ profiles }: { profiles: NetworkProfile[] }) {
  if (!profiles.length) return null

  return (
    <Card className="border border-mist-100 p-4">
      <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Professional network</p>
      <h2 className="mt-1 text-lg font-semibold text-navy-950">People you may know</h2>
      <div className="mt-3 divide-y divide-mist-100">
        {profiles.map((profile) => {
          const relationshipKey = `${profile.relationship.following ? 1 : 0}:${profile.relationship.connection.kind}:${profile.relationship.connection.connectionId ?? ''}`
          return (
            <article key={profile.id} className="py-3 first:pt-1 last:pb-1">
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist-100 text-xs font-semibold text-navy-950">
                  {initials(profile.fullName)}
                </div>
                <div className="min-w-0 flex-1">
                  <Link href={`/people/${profile.slug}`} className="block truncate text-sm font-semibold text-navy-950 hover:text-ocean-700">
                    {profile.fullName}
                  </Link>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted">
                    {profile.headline ?? [profile.rank, profile.currentCompany].filter(Boolean).join(' · ') || 'Maritime professional'}
                  </p>
                </div>
              </div>
              <div className="mt-2 pl-[3.25rem]">
                <RelationshipControls key={relationshipKey} profileId={profile.id} initialRelationship={profile.relationship} compact />
                <Link href={`/people/${profile.slug}`} className="mt-2 inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-ocean-700 hover:text-navy-950">
                  View profile <ArrowUpRight aria-hidden="true" className="size-3.5" />
                </Link>
              </div>
            </article>
          )
        })}
      </div>
    </Card>
  )
}

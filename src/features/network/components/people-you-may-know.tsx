import Link from 'next/link'
import { ArrowUpRight } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { NetworkProfile } from '../types'

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('')
}

export function PeopleYouMayKnow({ profiles }: { profiles: NetworkProfile[] }) {
  const visibleProfiles = profiles.slice(0, 3)
  if (!visibleProfiles.length) return null

  return (
    <Card className="border border-mist-100 p-4">
      <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Professional network</p>
      <h2 className="mt-1 text-lg font-semibold text-navy-950">People you may know</h2>
      <div className="mt-3 divide-y divide-mist-100">
        {visibleProfiles.map((profile) => {
          const identityLine = profile.summary ?? profile.headline ?? ([profile.rank, profile.currentCompany].filter(Boolean).join(' · ') || 'Maritime professional')
          return (
            <article key={profile.id} className="py-3 first:pt-1 last:pb-1">
              <div className="flex items-start gap-3">
                {profile.avatarPath ? (
                  // eslint-disable-next-line @next/next/no-img-element -- profile media may be hydrated to an external signed URL
                  <img src={profile.avatarPath} alt={`${profile.fullName} profile`} className="size-11 shrink-0 rounded-xl object-cover ring-1 ring-mist-100" />
                ) : (
                  <div className="grid size-11 shrink-0 place-items-center rounded-xl bg-mist-100 text-xs font-semibold text-navy-950">
                    {initials(profile.fullName)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-navy-950">{profile.fullName}</p>
                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted">{identityLine}</p>
                </div>
              </div>
              <Link href={`/people/${profile.slug}`} className="mt-2 ml-14 inline-flex min-h-8 items-center gap-1 text-xs font-semibold text-ocean-700 hover:text-navy-950">
                View profile <ArrowUpRight aria-hidden="true" className="size-3.5" />
              </Link>
            </article>
          )
        })}
      </div>
    </Card>
  )
}

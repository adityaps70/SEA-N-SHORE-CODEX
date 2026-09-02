import { BriefcaseBusiness, Compass, Gauge, Ship, Waves } from 'lucide-react'
import { Card } from '@/components/ui/card'
import type { PublicProfile } from '../types'

type Detail = { label: string; value: string; icon: typeof Ship }

export function MaritimeProfileCard({ profile }: { profile: PublicProfile }) {
  const details: Detail[] = [
    profile.rank ? { label: 'Rank', value: profile.rank, icon: Gauge } : null,
    profile.currentVessel ? { label: 'Current vessel', value: profile.currentVessel, icon: Ship } : null,
    profile.sailingExperienceYears !== null
      ? { label: 'Sailing experience', value: `${profile.sailingExperienceYears} years`, icon: Waves }
      : null,
    profile.vesselTypes.length
      ? { label: 'Vessel types', value: profile.vesselTypes.join(' · '), icon: BriefcaseBusiness }
      : null,
    profile.tradingAreas.length
      ? { label: 'Trading areas', value: profile.tradingAreas.join(' · '), icon: Compass }
      : null,
  ].filter((detail): detail is Detail => Boolean(detail))

  if (!details.length) return null

  return (
    <Card className="border border-mist-100 p-5 sm:p-7">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Professional record</p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight text-navy-950">Maritime experience</h2>
        </div>
        {profile.shoreCareerPreference ? (
          <span className="rounded-full bg-mist-50 px-3 py-1 text-xs font-semibold text-ocean-700">Open to shore career</span>
        ) : null}
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2">
        {details.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-2xl border border-mist-100 bg-mist-50/60 p-4">
            <dt className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.11em] text-muted">
              <Icon aria-hidden="true" className="size-4 text-ocean-700" />
              {label}
            </dt>
            <dd className="mt-2 text-sm font-semibold leading-6 text-navy-950">{value}</dd>
          </div>
        ))}
      </dl>
    </Card>
  )
}

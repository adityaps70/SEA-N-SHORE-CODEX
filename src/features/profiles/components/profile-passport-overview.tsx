import {
  Anchor,
  BriefcaseBusiness,
  CheckCircle2,
  Compass,
  Gauge,
  Map,
  Ship,
  Sparkles,
} from 'lucide-react'
import { getProfileReadiness } from '../profile-readiness'
import { profileAvailabilityLabel } from '../profile-availability'
import type { PublicProfile } from '../types'

function Metric({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Ship }) {
  return (
    <div className="rounded-2xl border border-mist-100 bg-white/90 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.12em] text-muted">
        <Icon aria-hidden="true" className="size-4 text-ocean-700" />
        {label}
      </div>
      <p className="mt-2 text-base font-semibold text-navy-950">{value}</p>
    </div>
  )
}

export function ProfilePassportOverview({
  profile,
  showReadiness = false,
}: {
  profile: PublicProfile
  showReadiness?: boolean
}) {
  const isMaritime = profile.profileType === 'seafarer' || profile.profileType === 'maritime_professional'
  const readiness = getProfileReadiness(profile)
  const availability = profileAvailabilityLabel(profile.availability)

  return (
    <section id="passport" className="overflow-hidden rounded-[1.75rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
      <div className="border-b border-mist-100 bg-[linear-gradient(135deg,rgba(4,48,77,.98),rgba(8,111,142,.94)_58%,rgba(20,184,166,.86))] px-5 py-5 text-white sm:px-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[.18em] text-white/70">
              <Anchor aria-hidden="true" className="size-4" />
              Sea N Shore professional identity
            </div>
            <h2 className="mt-2 text-2xl font-semibold tracking-[-.025em]">Maritime Passport</h2>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-white/75">
              A recruiter-ready view of your role, sea-service exposure, specialist experience and career status.
            </p>
          </div>
          {availability ? (
            <div className="inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold backdrop-blur">
              <span className="size-2 rounded-full bg-teal-300" aria-hidden="true" />
              {availability}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid gap-6 p-5 sm:p-7 xl:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Professional snapshot</p>
              <h3 className="mt-1 text-lg font-semibold text-navy-950">What a maritime recruiter needs first</h3>
            </div>
            <Sparkles aria-hidden="true" className="hidden size-5 text-teal-500 sm:block" />
          </div>

          {isMaritime ? (
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {profile.rank ? <Metric label="Rank" value={profile.rank} icon={Gauge} /> : null}
              {profile.sailingExperienceYears != null ? (
                <Metric label="Sea service" value={`${profile.sailingExperienceYears} years`} icon={Compass} />
              ) : null}
              {profile.currentVessel ? <Metric label="Current vessel" value={profile.currentVessel} icon={Ship} /> : null}
              {profile.currentCompany ? <Metric label="Company" value={profile.currentCompany} icon={BriefcaseBusiness} /> : null}
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {profile.headline ? <Metric label="Professional focus" value={profile.headline} icon={BriefcaseBusiness} /> : null}
              {profile.location ? <Metric label="Location" value={profile.location} icon={Map} /> : null}
            </div>
          )}

          {isMaritime && (profile.vesselTypes.length > 0 || profile.tradingAreas.length > 0) ? (
            <div className="mt-5 grid gap-5 md:grid-cols-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.13em] text-muted">Vessel experience</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {profile.vesselTypes.map((item) => (
                    <span key={item} className="rounded-full border border-ocean-100 bg-ocean-50 px-3 py-1.5 text-sm font-medium text-ocean-800">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.13em] text-muted">Trading areas</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {profile.tradingAreas.map((item) => (
                    <span key={item} className="inline-flex items-center gap-1.5 rounded-full border border-mist-100 bg-mist-50 px-3 py-1.5 text-sm font-medium text-navy-900">
                      <Map aria-hidden="true" className="size-3.5 text-ocean-600" />
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          ) : null}

          {profile.shoreCareerPreference ? (
            <div className="mt-5 inline-flex items-center gap-2 rounded-xl bg-teal-50 px-3 py-2 text-sm font-semibold text-teal-800">
              <CheckCircle2 aria-hidden="true" className="size-4" />
              Interested in shore opportunities
            </div>
          ) : null}
        </div>

        {showReadiness ? (
          <aside className="rounded-2xl border border-mist-100 bg-mist-50/70 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Profile readiness</p>
                <p className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">{readiness.score}%</p>
              </div>
              <div className="grid size-12 place-items-center rounded-full bg-white text-sm font-bold text-ocean-700 shadow-sm" aria-label={`${readiness.completed} of ${readiness.total} core profile checks complete`}>
                {readiness.completed}/{readiness.total}
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-mist-100" aria-hidden="true">
              <div className="h-full rounded-full bg-ocean-600" style={{ width: `${readiness.score}%` }} />
            </div>
            {readiness.nextSteps.length ? (
              <div className="mt-4">
                <p className="text-sm font-semibold text-navy-950">Improve your Passport</p>
                <ul className="mt-2 space-y-2 text-sm leading-5 text-muted">
                  {readiness.nextSteps.map((step) => (
                    <li key={step} className="flex gap-2">
                      <span className="mt-2 size-1.5 shrink-0 rounded-full bg-teal-500" aria-hidden="true" />
                      {step}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-4 text-sm leading-5 text-muted">Your core professional Passport is complete. Keep it current as your role changes.</p>
            )}
          </aside>
        ) : null}
      </div>
    </section>
  )
}

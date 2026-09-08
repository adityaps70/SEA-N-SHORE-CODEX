import Link from 'next/link'
import { ArrowUpRight, BriefcaseBusiness, Building2, Compass } from 'lucide-react'
import { Card } from '@/components/ui/card'
import { PeopleYouMayKnow } from '@/features/network/components/people-you-may-know'
import { RelationshipControls } from '@/features/network/components/relationship-controls'
import type { NetworkProfile } from '@/features/network/types'
import type { OwnProfile } from '@/features/profiles/types'
import type { PostCategory } from '../types'

function getJobSignals(profile: OwnProfile) {
  const signals: string[] = []

  const rank = profile.rank?.trim()
  if (rank) signals.push(`${rank} opportunities`)

  const vesselType = profile.vesselTypes.find((value) => value.trim().length > 0)?.trim()
  if (vesselType) signals.push(`${vesselType} opportunities`)

  if (profile.shoreCareerPreference) signals.push('Shore career pathways')

  if (!signals.length && profile.primaryIdentity?.trim()) {
    signals.push(`${profile.primaryIdentity.trim()} opportunities`)
  }

  if (!signals.length) signals.push('Maritime opportunities matched to your profile')

  return signals.slice(0, 3)
}

function isOrganisationProfile(profile: NetworkProfile) {
  return profile.identityRoot === 'organisation' || profile.profileType === 'company'
}

function getOrganisationNames(
  viewer: OwnProfile,
  suggestions: NetworkProfile[],
  organisationProfiles: NetworkProfile[],
) {
  const seen = new Set(
    organisationProfiles.map((profile) => profile.fullName.trim().toLocaleLowerCase()).filter(Boolean),
  )
  const viewerCompany = viewer.currentCompany?.trim().toLocaleLowerCase() ?? ''
  const names: string[] = []

  for (const suggestion of suggestions) {
    const company = suggestion.currentCompany?.trim()
    if (!company) continue

    const key = company.toLocaleLowerCase()
    if (key === viewerCompany || seen.has(key)) continue

    seen.add(key)
    names.push(company)
    if (organisationProfiles.length + names.length >= 3) break
  }

  return names
}

export function FeedDiscoveryRail({
  profile,
  suggestions,
}: {
  profile: OwnProfile
  category?: PostCategory
  suggestions: NetworkProfile[]
}) {
  const organisationProfiles = suggestions.filter(isOrganisationProfile).slice(0, 3)
  const peopleSuggestions = suggestions.filter((suggestion) => !isOrganisationProfile(suggestion))
  const organisationNames = getOrganisationNames(profile, peopleSuggestions, organisationProfiles)
  const jobSignals = getJobSignals(profile)

  return (
    <div className="space-y-4">
      <PeopleYouMayKnow profiles={peopleSuggestions} />

      <Card className="border border-mist-100 p-4">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist-50 text-ocean-700">
            <BriefcaseBusiness aria-hidden="true" className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Career matching</p>
            <h2 className="mt-1 text-lg font-semibold text-navy-950">Jobs for you</h2>
          </div>
        </div>

        <p className="mt-3 text-xs leading-5 text-muted">Based on the professional information already in your Sea N Shore profile.</p>
        <div className="mt-3 space-y-2">
          {jobSignals.map((signal, index) => (
            <div key={signal} className="flex items-center gap-2.5 rounded-xl bg-mist-50 px-3 py-2.5 text-sm font-semibold text-navy-900">
              {index === 2 && profile.shoreCareerPreference ? (
                <Compass aria-hidden="true" className="size-4 shrink-0 text-ocean-700" />
              ) : (
                <BriefcaseBusiness aria-hidden="true" className="size-4 shrink-0 text-ocean-700" />
              )}
              <span>{signal}</span>
            </div>
          ))}
        </div>

        <Link href="/jobs" className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ocean-700 hover:text-navy-950">
          Explore maritime jobs <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </Card>

      <Card className="border border-mist-100 p-4">
        <div className="flex items-start gap-3">
          <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-mist-50 text-ocean-700">
            <Building2 aria-hidden="true" className="size-4.5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Maritime network</p>
            <h2 className="mt-1 text-lg font-semibold text-navy-950">Organisations to follow</h2>
          </div>
        </div>

        {organisationProfiles.length || organisationNames.length ? (
          <div className="mt-3 divide-y divide-mist-100">
            {organisationProfiles.map((organisation) => {
              const relationshipKey = `${organisation.relationship.following ? 1 : 0}:${organisation.relationship.connection.kind}:${organisation.relationship.connection.connectionId ?? ''}`
              const identityLine = organisation.headline ?? organisation.primaryIdentity ?? organisation.location ?? 'Maritime organisation'

              return (
                <article key={organisation.id} className="py-3 first:pt-1">
                  <div className="flex items-start gap-3">
                    <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-mist-50 text-ocean-700">
                      <Building2 aria-hidden="true" className="size-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <Link href={`/people/${organisation.slug}`} className="block truncate text-sm font-semibold text-navy-950 hover:text-ocean-700">
                        {organisation.fullName}
                      </Link>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-muted">{identityLine}</p>
                    </div>
                  </div>
                  <div className="mt-2 pl-12">
                    <RelationshipControls
                      key={relationshipKey}
                      profileId={organisation.id}
                      initialRelationship={organisation.relationship}
                      compact
                    />
                  </div>
                </article>
              )
            })}

            {organisationNames.map((name) => (
              <Link
                key={name}
                href={`/network?tab=discover&q=${encodeURIComponent(name)}`}
                className="flex min-h-12 items-center gap-3 py-3 text-sm font-semibold text-navy-950 hover:text-ocean-700"
              >
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-mist-50 text-ocean-700">
                  <Building2 aria-hidden="true" className="size-4" />
                </span>
                <span className="min-w-0 flex-1 truncate">{name}</span>
                <ArrowUpRight aria-hidden="true" className="size-4 shrink-0" />
              </Link>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm leading-6 text-muted">Organisation suggestions will appear as more maritime companies complete their profiles.</p>
        )}

        <Link href="/network?tab=discover" className="mt-3 inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-ocean-700 hover:text-navy-950">
          Explore the maritime network <ArrowUpRight aria-hidden="true" className="size-4" />
        </Link>
      </Card>
    </div>
  )
}

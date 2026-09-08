import { PeopleYouMayKnow } from '@/features/network/components/people-you-may-know'
import type { NetworkProfile } from '@/features/network/types'

function isOrganisationProfile(profile: NetworkProfile) {
  return profile.identityRoot === 'organisation' || profile.profileType === 'company'
}

export function FeedDiscoveryRail({ suggestions }: { suggestions: NetworkProfile[] }) {
  const peopleSuggestions = suggestions.filter((suggestion) => !isOrganisationProfile(suggestion)).slice(0, 3)

  return (
    <div className="space-y-4">
      <PeopleYouMayKnow profiles={peopleSuggestions} />
    </div>
  )
}

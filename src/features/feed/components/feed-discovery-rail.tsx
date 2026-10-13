import { PeopleYouMayKnow } from '@/features/network/components/people-you-may-know'
import type { NetworkProfile } from '@/features/network/types'

/** Desktop right rail. People you may know shows 3 cards and keeps the rest as spares for Connect. */
export function FeedDiscoveryRail({ suggestions }: { suggestions: NetworkProfile[] }) {
  return (
    <div className="space-y-4">
      <PeopleYouMayKnow profiles={suggestions} />
    </div>
  )
}

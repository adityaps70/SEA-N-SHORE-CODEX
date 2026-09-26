import Link from 'next/link'
import { Lock } from 'lucide-react'
import { firstNameOf } from '../display-name'
import {
  profileNetworkListHref,
  type ProfileNetworkList,
  type ProfileNetworkSummary,
} from '../profile-network-links'

const numberFormat = new Intl.NumberFormat('en')

const LABELS: Record<ProfileNetworkList, [singular: string, plural: string]> = {
  connections: ['Connection', 'Connections'],
  followers: ['Follower', 'Followers'],
  following: ['Following', 'Following'],
}

export function profileNetworkPrivacyNote(summary: ProfileNetworkSummary, fullName: string) {
  if (summary.isOwner) return 'Your connections can see who is in these lists. Other members see only the numbers.'
  if (summary.canViewLists) return 'You can see these lists because you are connected.'
  return `Only ${firstNameOf(fullName, 'this member')}'s connections can see who is in these lists.`
}

export function ProfileNetworkStats({
  summary,
  slug,
  fullName,
}: {
  summary: ProfileNetworkSummary
  slug: string
  fullName: string
}) {
  const lists: ProfileNetworkList[] = ['connections', 'followers', 'following']

  return (
    <div data-testid="profile-network-stats" className="mt-4">
      <ul aria-label="Network" className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
        {lists.map((list) => {
          const count = summary.counts[list]
          const [singular, plural] = LABELS[list]
          const content = (
            <>
              <span className="font-semibold text-navy-950">{numberFormat.format(count)}</span>
              <span className="text-muted">{count === 1 ? singular : plural}</span>
            </>
          )
          return (
            <li key={list}>
              {summary.canViewLists ? (
                <Link
                  href={profileNetworkListHref(list, { isOwner: summary.isOwner, slug })}
                  className="inline-flex items-baseline gap-1 rounded-md hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2"
                >
                  {content}
                </Link>
              ) : (
                <span className="inline-flex items-baseline gap-1">{content}</span>
              )}
            </li>
          )
        })}
      </ul>
      <p className="mt-1.5 flex items-start gap-1.5 text-xs text-muted">
        <Lock aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
        {profileNetworkPrivacyNote(summary, fullName)}
      </p>
    </div>
  )
}

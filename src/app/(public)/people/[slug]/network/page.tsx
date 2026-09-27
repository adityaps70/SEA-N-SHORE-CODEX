import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Lock } from 'lucide-react'
import { requireUser } from '@/features/auth/queries'
import { ProfileDirectoryCard } from '@/features/profiles/components/profile-directory-card'
import {
  parseProfileNetworkList,
  PROFILE_NETWORK_LIST_LIMIT,
  PROFILE_NETWORK_LISTS,
  profileNetworkListHref,
  type ProfileNetworkList,
} from '@/features/profiles/profile-network-links'
import { getProfileNetworkListIds, getProfileNetworkSummary } from '@/features/profiles/profile-network-stats'
import { getPublicProfileBySlug, getPublicProfilesByIds } from '@/features/profiles/queries'

export const metadata: Metadata = { title: 'Network' }

const LIST_LABELS: Record<ProfileNetworkList, string> = {
  connections: 'Connections',
  followers: 'Followers',
  following: 'Following',
}

function firstNameOf(fullName: string) {
  return fullName.trim().split(/\s+/)[0] || 'This member'
}

function emptyCopy(list: ProfileNetworkList, firstName: string) {
  if (list === 'connections') return `${firstName} has no connections yet.`
  if (list === 'followers') return `Nobody follows ${firstName} yet.`
  return `${firstName} is not following anyone yet.`
}

export default async function PersonNetworkPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ view?: string }>
}) {
  const [{ slug }, { view }] = await Promise.all([params, searchParams])
  const list = parseProfileNetworkList(view)
  const viewer = await requireUser()
  const profile = await getPublicProfileBySlug(slug)
  if (!profile) notFound()
  if (viewer.id === profile.id) redirect(profileNetworkListHref(list, { isOwner: true, slug: profile.slug }))

  const [summary, ids] = await Promise.all([
    getProfileNetworkSummary(viewer.id, profile.id),
    getProfileNetworkListIds(viewer.id, profile.id, list),
  ])
  const people = ids?.length ? await getPublicProfilesByIds(ids) : []
  const firstName = firstNameOf(profile.fullName)

  return (
    <main id="main-content" className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <div>
        <Link
          href={`/people/${profile.slug}`}
          className="inline-flex min-h-10 items-center gap-2 rounded-xl text-sm font-semibold text-ocean-700 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
          Back to {profile.fullName}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold tracking-[-.025em] text-navy-950 sm:text-3xl">
          {profile.fullName}&apos;s network
        </h1>
      </div>

      <nav aria-label="Network lists" className="flex flex-wrap gap-2">
        {PROFILE_NETWORK_LISTS.map((entry) => {
          const selected = entry === list
          const count = summary?.counts[entry]
          return (
            <Link
              key={entry}
              href={profileNetworkListHref(entry, { isOwner: false, slug: profile.slug })}
              aria-current={selected ? 'page' : undefined}
              className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 ${
                selected ? 'border-navy-950 bg-navy-950 text-white' : 'border-mist-100 bg-white text-navy-950 hover:border-ocean-300'
              }`}
            >
              {LIST_LABELS[entry]}
              {typeof count === 'number' ? <span className={selected ? 'text-white/80' : 'text-muted'}>{count}</span> : null}
            </Link>
          )
        })}
      </nav>

      {ids === null ? (
        <div className="rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-10 text-center">
          <Lock aria-hidden="true" className="mx-auto size-5 text-muted" />
          <p className="mt-3 font-semibold text-navy-950">Only {firstName}&apos;s connections can see this list.</p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">
            Signed-in members can see how many connections and followers someone has. Connect with {firstName} to see who is in their network.
          </p>
          <Link
            href={`/people/${profile.slug}`}
            className="mt-5 inline-flex min-h-11 items-center rounded-xl bg-navy-950 px-5 text-sm font-semibold text-white hover:bg-ocean-700"
          >
            Go to {firstName}&apos;s profile
          </Link>
        </div>
      ) : people.length ? (
        <>
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {people.map((person) => (
              <li key={person.id} className="min-w-0">
                <ProfileDirectoryCard profile={person} />
              </li>
            ))}
          </ul>
          {ids.length >= PROFILE_NETWORK_LIST_LIMIT ? (
            <p className="text-center text-xs text-muted">Showing the {PROFILE_NETWORK_LIST_LIMIT} most recent.</p>
          ) : null}
        </>
      ) : (
        <div className="rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-10 text-center text-sm text-muted">
          {emptyCopy(list, firstName)}
        </div>
      )}
    </main>
  )
}

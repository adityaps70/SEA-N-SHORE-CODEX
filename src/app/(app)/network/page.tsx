import { UsersRound } from 'lucide-react'
import { ProfileDirectoryCard } from '@/features/profiles/components/profile-directory-card'
import { getNetworkProfiles } from '@/features/profiles/queries'

export default async function NetworkPage() {
  const profiles = await getNetworkProfiles()

  return (
    <section className="py-2 sm:py-5">
      <div className="rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white">
            <UsersRound aria-hidden="true" className="size-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Maritime network</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] text-navy-950">People worth knowing at sea and ashore.</h1>
            <p className="mt-2 max-w-2xl leading-7 text-muted">
              Discover seafarers, shore professionals, trainers, mentors, recruiters, and maritime businesses already building their professional identity on Sea N Shore.
            </p>
          </div>
        </div>
      </div>

      {profiles.length ? (
        <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {profiles.map((profile) => <ProfileDirectoryCard key={profile.id} profile={profile} />)}
        </div>
      ) : (
        <div className="mt-5 rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-12 text-center">
          <p className="font-semibold text-navy-950">Your network is ready for its first connections.</p>
          <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">
            Completed professional profiles will appear here as the community grows. Follow and connection requests are the next social-graph milestone.
          </p>
        </div>
      )}
    </section>
  )
}

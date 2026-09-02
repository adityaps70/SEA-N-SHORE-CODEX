import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ArrowUpRight, Eye, LockKeyhole } from 'lucide-react'
import { MaritimeProfileCard } from '@/features/profiles/components/maritime-profile-card'
import { ProfileAbout } from '@/features/profiles/components/profile-about'
import { ProfileHeader } from '@/features/profiles/components/profile-header'
import { getOwnProfile } from '@/features/profiles/queries'

export default async function OwnProfilePage() {
  const profile = await getOwnProfile()
  if (!profile) redirect('/onboarding')

  return (
    <section className="grid gap-5 py-2 sm:py-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.14em] text-ocean-700">Professional identity</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-navy-950">My profile</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-mist-100 bg-white px-3 text-sm font-medium text-muted">
            <LockKeyhole aria-hidden="true" className="size-4" />
            Contact: {profile.contactVisibility}
          </span>
          <Link
            href={`/people/${profile.slug}`}
            className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white hover:bg-ocean-700"
          >
            <Eye aria-hidden="true" className="size-4" />
            View public profile
            <ArrowUpRight aria-hidden="true" className="size-4" />
          </Link>
        </div>
      </div>

      <ProfileHeader profile={profile} />
      <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <ProfileAbout profile={profile} />
        <MaritimeProfileCard profile={profile} />
      </div>
    </section>
  )
}

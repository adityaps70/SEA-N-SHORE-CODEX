import { notFound } from 'next/navigation'
import { MaritimeProfileCard } from '@/features/profiles/components/maritime-profile-card'
import { ProfileAbout } from '@/features/profiles/components/profile-about'
import { ProfileHeader } from '@/features/profiles/components/profile-header'
import { getPublicProfileBySlug } from '@/features/profiles/queries'

export default async function PublicProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const profile = await getPublicProfileBySlug(slug)
  if (!profile) notFound()

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <ProfileHeader profile={profile} />
      <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <ProfileAbout profile={profile} />
        <MaritimeProfileCard profile={profile} />
      </div>
      <p className="px-1 text-center text-xs leading-5 text-muted">
        Sea N Shore professional profiles are member-provided. Verification badges will appear only after the formal evidence review workflow is enabled.
      </p>
    </main>
  )
}

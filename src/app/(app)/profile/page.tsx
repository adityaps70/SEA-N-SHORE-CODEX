import { redirect } from 'next/navigation'
import { getPostsByAuthor } from '@/features/feed/queries'
import { ProfilePostsSection } from '@/features/feed/components/profile-posts-section'
import { MaritimeProfileCard } from '@/features/profiles/components/maritime-profile-card'
import { ProfileAbout } from '@/features/profiles/components/profile-about'
import { ProfileCareerTimeline } from '@/features/profiles/components/profile-career-timeline'
import { ProfileCredentialWallet } from '@/features/profiles/components/profile-credential-wallet'
import { ProfileHeader } from '@/features/profiles/components/profile-header'
import { ProfileMediaControls } from '@/features/profiles/components/profile-media-controls'
import { ProfilePassportOverview } from '@/features/profiles/components/profile-passport-overview'
import { ProfilePassportToolbar } from '@/features/profiles/components/profile-passport-toolbar'
import { getOwnProfilePortfolio } from '@/features/profiles/profile-portfolio-queries'
import { getOwnProfile } from '@/features/profiles/queries'

export default async function OwnProfilePage() {
  const [profile, portfolio] = await Promise.all([
    getOwnProfile(),
    getOwnProfilePortfolio(),
  ])
  if (!profile) redirect('/onboarding')
  const posts = await getPostsByAuthor(profile.id)

  return (
    <section className="grid gap-5 py-2 sm:py-5">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.14em] text-ocean-700">Professional identity</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight text-navy-950 sm:text-3xl">My Maritime Passport</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
            Keep one maritime career profile ready for the community, employers and recruiters.
          </p>
        </div>
        <ProfilePassportToolbar slug={profile.slug} />
      </div>

      <ProfileHeader
        profile={profile}
        editHref="inline"
        contactVisibility={profile.contactVisibility}
        mediaControls={<ProfileMediaControls kind="cover" hasImage={Boolean(profile.coverPath)} />}
        avatarControls={<ProfileMediaControls kind="avatar" hasImage={Boolean(profile.avatarPath)} />}
      />

      <ProfilePassportOverview profile={profile} showReadiness />

      <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <ProfileAbout profile={profile} editHref="inline" />
        <MaritimeProfileCard profile={profile} editHref="inline" />
      </div>

      <ProfileCareerTimeline experiences={portfolio.experiences} editable />
      <ProfileCredentialWallet credentials={portfolio.credentials} editable />
      <ProfilePostsSection posts={posts} ownerName={profile.fullName} />
    </section>
  )
}

import { redirect } from 'next/navigation'
import { PeopleYouMayKnow } from '@/features/network/components/people-you-may-know'
import { getPeopleYouMayKnow } from '@/features/network/queries'
import { MaritimeProfileCard } from '@/features/profiles/components/maritime-profile-card'
import { ProfileAbout } from '@/features/profiles/components/profile-about'
import { ProfileCareerTimeline } from '@/features/profiles/components/profile-career-timeline'
import { ProfileCredentialWallet } from '@/features/profiles/components/profile-credential-wallet'
import { ProfileHeader } from '@/features/profiles/components/profile-header'
import { ProfileMediaControls } from '@/features/profiles/components/profile-media-controls'
import { ProfilePassportToolbar } from '@/features/profiles/components/profile-passport-toolbar'
import { getOwnProfilePortfolio } from '@/features/profiles/profile-portfolio-queries'
import { getOwnProfile } from '@/features/profiles/queries'

export default async function OwnProfilePage() {
  const [profile, portfolio, recommendations] = await Promise.all([
    getOwnProfile(),
    getOwnProfilePortfolio(),
    getPeopleYouMayKnow(3),
  ])
  if (!profile) redirect('/onboarding')

  return (
    <section className="grid gap-4 py-2 sm:py-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 gap-4">
        <ProfileHeader
          profile={profile}
          editHref="inline"
          contactVisibility={profile.contactVisibility}
          mediaControls={<ProfileMediaControls kind="cover" hasImage={Boolean(profile.coverPath)} />}
          avatarControls={<ProfileMediaControls kind="avatar" hasImage={Boolean(profile.avatarPath)} />}
          actions={<ProfilePassportToolbar slug={profile.slug} />}
        />

        <ProfileAbout profile={profile} editHref="inline" />
        <MaritimeProfileCard profile={profile} editHref="inline" />
        <ProfileCareerTimeline experiences={portfolio.experiences} editable />
        <ProfileCredentialWallet credentials={portfolio.credentials} editable />
      </div>

      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <PeopleYouMayKnow profiles={recommendations} />
      </aside>
    </section>
  )
}

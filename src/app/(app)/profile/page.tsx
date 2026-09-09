import { redirect } from 'next/navigation'
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
  const [profile, portfolio] = await Promise.all([
    getOwnProfile(),
    getOwnProfilePortfolio(),
  ])
  if (!profile) redirect('/onboarding')

  return (
    <section className="grid gap-4 py-2 sm:py-5">
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
    </section>
  )
}

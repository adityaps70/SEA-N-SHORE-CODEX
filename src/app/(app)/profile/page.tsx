import type { Metadata } from 'next'
import { redirect } from 'next/navigation'
import { RailFooter } from '@/components/navigation/rail-footer'
import { getAccessContext } from '@/features/access/server'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { PeopleYouMayKnow } from '@/features/network/components/people-you-may-know'
import { getPeopleYouMayKnow } from '@/features/network/queries'
import { MaritimeProfileCard } from '@/features/profiles/components/maritime-profile-card'
import { ProfileAbout } from '@/features/profiles/components/profile-about'
import { ProfileCareerTimeline } from '@/features/profiles/components/profile-career-timeline'
import { ProfileCredentialWallet } from '@/features/profiles/components/profile-credential-wallet'
import { DgProfileOnFileBadge } from '@/features/profiles/components/dg-profile-upload'
import { ProfileDgDocumentCard } from '@/features/profiles/components/profile-dg-document-card'
import { ProfileNetworkStats } from '@/features/profiles/components/profile-network-stats'
import { ProfileHeader } from '@/features/profiles/components/profile-header'
import { ProfileMediaControls } from '@/features/profiles/components/profile-media-controls'
import { ProfileMembershipCard } from '@/features/profiles/components/profile-membership-card'
import { ProfileOrganizations } from '@/features/profiles/components/profile-organizations'
import { ProfilePassportToolbar } from '@/features/profiles/components/profile-passport-toolbar'
import { getOwnProfilePortfolio } from '@/features/profiles/profile-portfolio-queries'
import { getOwnDgProfileDocument } from '@/features/profiles/profile-document-service'
import { getProfileNetworkSummary } from '@/features/profiles/profile-network-stats'
import { getOwnProfile, getProfileOrganizations } from '@/features/profiles/queries'

export const metadata: Metadata = { title: 'My profile' }

export default async function OwnProfilePage() {
  const user = await requireAwsUser()
  const [profile, portfolio, recommendations, access, organizations, networkSummary, dgProfile] = await Promise.all([
    getOwnProfile(),
    getOwnProfilePortfolio(),
    getPeopleYouMayKnow(3),
    getAccessContext(user.id),
    getProfileOrganizations(user.id),
    getProfileNetworkSummary(user.id, user.id).catch(() => null),
    getOwnDgProfileDocument(user.id).catch(() => null),
  ])
  if (!profile) redirect('/onboarding')
  const isSeafarer = profile.persona ? profile.persona === 'seafarer' : profile.profileType === 'seafarer'

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
          badges={dgProfile ? <DgProfileOnFileBadge /> : undefined}
          stats={networkSummary ? (
            <ProfileNetworkStats summary={networkSummary} slug={profile.slug} fullName={profile.fullName} />
          ) : undefined}
        />

        <ProfileAbout profile={profile} editHref="inline" />
        <MaritimeProfileCard profile={profile} editHref="inline" />
        <ProfileOrganizations organizations={organizations} editable />
        <ProfileCareerTimeline experiences={portfolio.experiences} editable />
        <ProfileCredentialWallet credentials={portfolio.credentials} editable />
        {isSeafarer || dgProfile ? <ProfileDgDocumentCard profileId={profile.id} document={dgProfile} /> : null}
        <ProfileMembershipCard profile={profile} access={access} />
      </div>

      <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
        <PeopleYouMayKnow profiles={recommendations} />
        <RailFooter visibleFrom="lg" />
      </aside>
    </section>
  )
}

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
import { ProfileCardEditingProvider } from '@/features/profiles/components/profile-card-editing'
import { ProfileOrganizations } from '@/features/profiles/components/profile-organizations'
import { ProfilePassportToolbar } from '@/features/profiles/components/profile-passport-toolbar'
import { personaForProfile } from '@/features/profiles/profile-persona-rules'
import { getOwnProfilePortfolio } from '@/features/profiles/profile-portfolio-queries'
import { getOwnDgProfileDocument } from '@/features/profiles/profile-document-service'
import { getProfileNetworkSummary } from '@/features/profiles/profile-network-stats'
import { getOwnProfile, getOwnRegisteredOrganization, getProfileOrganizations } from '@/features/profiles/queries'

export const metadata: Metadata = { title: 'My profile' }

/**
 * My Profile (round 11): every card edits what it shows in place, one card at a time; nothing here
 * sends the member to /profile/edit.
 */
export default async function OwnProfilePage({
  searchParams,
}: {
  /** `registered`: an organization the member just registered from the header's organization picker. */
  searchParams?: Promise<{ registered?: string | string[] }>
} = {}) {
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
  const registered = (await searchParams)?.registered
  const registeredOrganization = registered ? await getOwnRegisteredOrganization(registered) : null
  const persona = personaForProfile(profile)

  return (
    <ProfileCardEditingProvider>
    <section className="grid gap-4 py-2 max-md:-mt-4 max-md:gap-2 max-md:py-0 sm:py-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 gap-4 max-md:gap-2">
        <ProfileHeader
          profile={profile}
          editHref="inline"
          contactVisibility={profile.contactVisibility}
          registeredOrganization={registeredOrganization}
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
        <ProfileOrganizations
          organizations={organizations}
          editable
          current={{ name: profile.currentCompany, organization: profile.currentOrganization ?? null }}
          organisationAccount={profile.identityRoot === 'organisation'}
        />
        <ProfileCareerTimeline experiences={portfolio.experiences} editable persona={persona} />
        <ProfileCredentialWallet credentials={portfolio.credentials} editable persona={persona} />
        {isSeafarer || dgProfile ? <ProfileDgDocumentCard profileId={profile.id} document={dgProfile} /> : null}
        {/* Phones: membership and verifications live in Settings → Plan & billing. */}
        <div className="min-w-0 max-md:hidden">
          <ProfileMembershipCard profile={profile} access={access} />
        </div>
      </div>

      {/* Phones: People you may know lives on the Network tab. */}
      <aside className="min-w-0 max-md:hidden lg:sticky lg:top-24 lg:self-start">
        <PeopleYouMayKnow profiles={recommendations} />
        <RailFooter visibleFrom="lg" />
      </aside>
    </section>
    </ProfileCardEditingProvider>
  )
}

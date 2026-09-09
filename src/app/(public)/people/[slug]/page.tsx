import { notFound } from 'next/navigation'
import { getVerifiedUser } from '@/features/auth/queries'
import { PeopleYouMayKnow } from '@/features/network/components/people-you-may-know'
import { RelationshipControls } from '@/features/network/components/relationship-controls'
import { getPeopleYouMayKnow, getRelationshipState } from '@/features/network/queries'
import { MaritimeProfileCard } from '@/features/profiles/components/maritime-profile-card'
import { ProfileAbout } from '@/features/profiles/components/profile-about'
import { ProfileCareerTimeline } from '@/features/profiles/components/profile-career-timeline'
import { ProfileCredentialWallet } from '@/features/profiles/components/profile-credential-wallet'
import { ProfileHeader } from '@/features/profiles/components/profile-header'
import { getProfilePortfolioById } from '@/features/profiles/profile-portfolio-queries'
import { getPublicProfileBySlug } from '@/features/profiles/queries'

export default async function PublicProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [profile, viewer] = await Promise.all([
    getPublicProfileBySlug(slug),
    getVerifiedUser(),
  ])
  if (!profile) notFound()

  const [relationship, portfolio, recommendations] = await Promise.all([
    viewer && viewer.id !== profile.id ? getRelationshipState(profile.id) : null,
    getProfilePortfolioById(profile.id),
    viewer ? getPeopleYouMayKnow(3) : Promise.resolve([]),
  ])
  const relationshipKey = relationship
    ? `${relationship.following ? 1 : 0}:${relationship.connection.kind}:${relationship.connection.connectionId ?? ''}`
    : ''

  return (
    <main className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 gap-5">
        <ProfileHeader
          profile={profile}
          actions={relationship ? (
            <RelationshipControls key={relationshipKey} profileId={profile.id} initialRelationship={relationship} />
          ) : undefined}
        />

        <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
          <ProfileAbout profile={profile} />
          <MaritimeProfileCard profile={profile} />
        </div>

        <ProfileCareerTimeline experiences={portfolio.experiences} />
        <ProfileCredentialWallet credentials={portfolio.credentials} />

        <p className="px-1 text-center text-xs leading-5 text-muted">
          Sea N Shore professional profiles are member-provided. Verification badges will appear only after the formal evidence review workflow is enabled.
        </p>
      </div>

      {viewer ? (
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <PeopleYouMayKnow profiles={recommendations} />
        </aside>
      ) : null}
    </main>
  )
}

import { notFound } from 'next/navigation'
import { getVerifiedUser } from '@/features/auth/queries'
import { RelationshipControls } from '@/features/network/components/relationship-controls'
import { getRelationshipState } from '@/features/network/queries'
import { MaritimeProfileCard } from '@/features/profiles/components/maritime-profile-card'
import { ProfileAbout } from '@/features/profiles/components/profile-about'
import { ProfileCareerTimeline } from '@/features/profiles/components/profile-career-timeline'
import { ProfileHeader } from '@/features/profiles/components/profile-header'
import { ProfilePassportOverview } from '@/features/profiles/components/profile-passport-overview'
import { getProfilePortfolioById } from '@/features/profiles/profile-portfolio-queries'
import { getPublicProfileBySlug } from '@/features/profiles/queries'

export default async function PublicProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [profile, viewer] = await Promise.all([
    getPublicProfileBySlug(slug),
    getVerifiedUser(),
  ])
  if (!profile) notFound()

  const [relationship, portfolio] = await Promise.all([
    viewer && viewer.id !== profile.id ? getRelationshipState(profile.id) : null,
    getProfilePortfolioById(profile.id),
  ])
  const relationshipKey = relationship
    ? `${relationship.following ? 1 : 0}:${relationship.connection.kind}:${relationship.connection.connectionId ?? ''}`
    : ''

  return (
    <main className="mx-auto grid w-full max-w-5xl gap-5 px-4 py-6 sm:px-6 sm:py-10">
      <ProfileHeader
        profile={profile}
        actions={relationship ? (
          <RelationshipControls key={relationshipKey} profileId={profile.id} initialRelationship={relationship} />
        ) : undefined}
      />

      <ProfilePassportOverview profile={profile} />

      <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
        <ProfileAbout profile={profile} />
        <MaritimeProfileCard profile={profile} />
      </div>

      <ProfileCareerTimeline experiences={portfolio.experiences} />

      <p className="px-1 text-center text-xs leading-5 text-muted">
        Sea N Shore professional profiles are member-provided. Verification badges will appear only after the formal evidence review workflow is enabled.
      </p>
    </main>
  )
}

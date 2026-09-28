import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import { RailFooter } from '@/components/navigation/rail-footer'
import { getVerifiedUser } from '@/features/auth/queries'
import { PostCard } from '@/features/feed/components/post-card'
import { getPublicPostsByAuthor } from '@/features/feed/queries'
import { PeopleYouMayKnow } from '@/features/network/components/people-you-may-know'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'
import { RelationshipControls } from '@/features/network/components/relationship-controls'
import { getPeopleYouMayKnow, getRelationshipState } from '@/features/network/queries'
import { MaritimeProfileCard } from '@/features/profiles/components/maritime-profile-card'
import { ProfileAbout } from '@/features/profiles/components/profile-about'
import { ProfileCareerTimeline } from '@/features/profiles/components/profile-career-timeline'
import { ProfileCredentialWallet } from '@/features/profiles/components/profile-credential-wallet'
import { ProfileDgDocumentViewerCard } from '@/features/profiles/components/profile-dg-document-card'
import { ProfileHeader } from '@/features/profiles/components/profile-header'
import { ProfileNetworkStats } from '@/features/profiles/components/profile-network-stats'
import { ProfileOrganizations } from '@/features/profiles/components/profile-organizations'
import { getViewableDgProfileDocument } from '@/features/profiles/profile-document-service'
import { getProfileNetworkSummary } from '@/features/profiles/profile-network-stats'
import { getProfilePortfolioById } from '@/features/profiles/profile-portfolio-queries'
import { getProfileOrganizations, getPublicProfileBySlug } from '@/features/profiles/queries'
import { MessagingRealtimeProvider } from '@/features/realtime/provider'

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const profile = await getPublicProfileBySlug(slug)
  if (!profile) return { title: 'Member not found' }
  return {
    title: profile.headline ? `${profile.fullName} · ${profile.headline}` : profile.fullName,
    description: profile.summary ?? undefined,
  }
}

export default async function PublicProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [profile, viewer] = await Promise.all([
    getPublicProfileBySlug(slug),
    getVerifiedUser(),
  ])
  if (!profile) notFound()

  const viewingSomeoneElse = Boolean(viewer && viewer.id !== profile.id)
  const [relationship, portfolio, recommendations, posts, networkSummary, dgProfile, organizations] = await Promise.all([
    viewer && viewingSomeoneElse ? getRelationshipState(profile.id) : null,
    getProfilePortfolioById(profile.id),
    viewer ? getPeopleYouMayKnow(3) : Promise.resolve([]),
    getPublicPostsByAuthor(profile.id),
    // Counts are for signed-in members only; signed-out visitors see none.
    viewer ? getProfileNetworkSummary(viewer.id, profile.id).catch(() => null) : null,
    viewer && viewingSomeoneElse ? getViewableDgProfileDocument(viewer.id, profile.id).catch(() => null) : null,
    getProfileOrganizations(profile.id),
  ])
  const relationshipKey = relationship
    ? `${relationship.following ? 1 : 0}:${relationship.connection.kind}:${relationship.connection.connectionId ?? ''}`
    : ''

  const profileContent = (
    <main className="mx-auto grid w-full max-w-6xl gap-4 px-4 py-4 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="grid min-w-0 gap-4">
        <ProfileHeader
          profile={profile}
          actions={relationship ? (
            <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
              <RelationshipControls key={relationshipKey} profileId={profile.id} initialRelationship={relationship} />
              <ReportContentButton targetType="profile" targetId={profile.id} label="Report profile" />
            </div>
          ) : undefined}
          stats={networkSummary ? (
            <ProfileNetworkStats summary={networkSummary} slug={profile.slug} fullName={profile.fullName} />
          ) : undefined}
        />

        <ProfileAbout profile={profile} />
        <MaritimeProfileCard profile={profile} />
        <ProfileOrganizations organizations={organizations} />

        <ProfileCareerTimeline experiences={portfolio.experiences} />
        <ProfileCredentialWallet credentials={portfolio.credentials} />
        {dgProfile && dgProfile.reason !== 'owner' ? (
          <ProfileDgDocumentViewerCard
            profileId={profile.id}
            fullName={profile.fullName}
            document={dgProfile}
            reason={dgProfile.reason}
          />
        ) : null}

        <section aria-labelledby="profile-posts-heading" className="grid gap-4">
          <div className="flex items-baseline justify-between gap-4 px-1">
            <h2 id="profile-posts-heading" className="text-lg font-bold text-navy-950">Posts</h2>
            <span className="text-sm text-muted">{posts.length} published</span>
          </div>
          {posts.length ? (
            <div className="space-y-4">
              {posts.map((post) => <PostCard key={post.id} post={post} readOnly={!viewer} />)}
            </div>
          ) : (
            <div className="rounded-[var(--radius-card)] border border-dashed border-mist-100 bg-white px-6 py-8 text-center text-sm text-muted">
              No posts published yet.
            </div>
          )}
        </section>

        <p className="px-1 text-center text-xs leading-5 text-muted">
          Sea N Shore professional profiles are member-provided. Verification badges will appear only after the formal evidence review workflow is enabled.
        </p>
      </div>

      {viewer ? (
        <aside className="min-w-0 lg:sticky lg:top-24 lg:self-start">
          <PeopleYouMayKnow profiles={recommendations} />
          <RailFooter visibleFrom="lg" />
        </aside>
      ) : null}
    </main>
  )

  return viewer ? (
    <MessagingRealtimeProvider viewerProfileId={viewer.id}>{profileContent}</MessagingRealtimeProvider>
  ) : profileContent
}

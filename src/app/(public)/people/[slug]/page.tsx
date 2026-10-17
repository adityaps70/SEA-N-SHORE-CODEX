import { postLoadingPriority } from '@/features/feed/post-loading-priority'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { cache } from 'react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { RailFooter } from '@/components/navigation/rail-footer'
import { getVerifiedUser } from '@/features/auth/queries'
import { PostCard } from '@/features/feed/components/post-card'
import { getPostsByAuthor, getPublicPostsByAuthor } from '@/features/feed/queries'
import { PeopleYouMayKnow } from '@/features/network/components/people-you-may-know'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'
import { RelationshipControls } from '@/features/network/components/relationship-controls'
import { relationshipMenuEventName } from '@/features/network/components/relationship-menu-event'
import { RelationshipMenuTrigger } from '@/features/network/components/relationship-menu-trigger'
import { getPeopleSimilarTo, getPeopleYouMayKnow, getRelationshipState } from '@/features/network/queries'
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
import { privacyPreferences } from '@/features/profiles/privacy-preferences'
import { personJsonLd, profileMetadata } from '@/features/profiles/profile-seo'
import { siteOrigin } from '@/features/learning/course-seo'
import { authHrefWithReturn } from '@/lib/auth/return-path'
import { jsonLd } from '@/lib/seo/meta'

// Round H (H5): one read per request for metadata and the page; a failed read counts as "not allowed".
const allowsSearchIndexing = cache((profileId: string) => privacyPreferences.allowsSearchIndexing(profileId).catch(() => false))

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const profile = await getPublicProfileBySlug(slug)
  if (!profile) return { title: 'Member not found' }
  // Round H (H5): noindex unless the owner lets search engines show the profile; then a canonical address.
  return profileMetadata(profile, { allowIndexing: await allowsSearchIndexing(profile.id) })
}

export default async function PublicProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const [profile, viewer] = await Promise.all([
    getPublicProfileBySlug(slug),
    getVerifiedUser(),
  ])
  if (!profile) notFound()

  const viewingSomeoneElse = Boolean(viewer && viewer.id !== profile.id)
  const [allowIndexing, relationship, portfolio, recommendations, posts, networkSummary, dgProfile, organizations, similarPeople] = await Promise.all([
    allowsSearchIndexing(profile.id),
    viewer && viewingSomeoneElse ? getRelationshipState(profile.id) : null,
    getProfilePortfolioById(profile.id),
    viewer ? getPeopleYouMayKnow() : Promise.resolve([]),
    // Round F: members see the author's posts by the member rules; signed-out visitors only "Anyone" posts.
    viewer ? getPostsByAuthor(profile.id) : getPublicPostsByAuthor(profile.id),
    // Counts are for signed-in members only; signed-out visitors see none.
    viewer ? getProfileNetworkSummary(viewer.id, profile.id).catch(() => null) : null,
    viewer && viewingSomeoneElse ? getViewableDgProfileDocument(viewer.id, profile.id).catch(() => null) : null,
    getProfileOrganizations(profile.id),
    // Round G (G2): people like this member (same rank band, vessel group or company), separate from People you may know.
    viewer && viewingSomeoneElse ? getPeopleSimilarTo(profile.id).catch(() => []) : Promise.resolve([]),
  ])
  const relationshipKey = relationship
    ? `${relationship.following ? 1 : 0}:${relationship.connection.kind}:${relationship.connection.connectionId ?? ''}`
    : ''

  const profileContent = (
    <main className={`mx-auto grid w-full max-w-6xl gap-4 px-4 py-4 max-md:gap-2 sm:px-6 sm:py-8 lg:grid-cols-[minmax(0,1fr)_300px] ${viewer ? '' : 'max-md:pb-24 max-md:pt-0'}`}>
      <div className="grid min-w-0 gap-4 max-md:gap-2">
        {/* Round H (H5): Person structured data only for members who allow search engines. */}
        {allowIndexing ? (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(personJsonLd(profile, siteOrigin())) }} />
        ) : null}
        {viewer ? (
          <MobilePageBar
            backHref="/home"
            title={profile.fullName}
            className="!mb-0"
            right={relationship ? (
              <RelationshipMenuTrigger profileId={profile.id} label={`More actions for ${profile.fullName}`} />
            ) : undefined}
          />
        ) : null}
        <ProfileHeader
          profile={profile}
          actions={relationship ? (
            <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
              <RelationshipControls
                key={relationshipKey}
                profileId={profile.id}
                initialRelationship={relationship}
                variant="profile"
                reportProfile
                openMenuEvent={relationshipMenuEventName(profile.id)}
              />
              {/* Phones: Report profile sits in the "…" sheet. */}
              <div className="max-md:hidden">
                <ReportContentButton targetType="profile" targetId={profile.id} label="Report profile" />
              </div>
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
        <ProfileCredentialWallet credentials={portfolio.credentials} learningCertificates={portfolio.learningCertificates} />
        {dgProfile && dgProfile.reason !== 'owner' ? (
          <ProfileDgDocumentViewerCard
            profileId={profile.id}
            fullName={profile.fullName}
            document={dgProfile}
            reason={dgProfile.reason}
          />
        ) : null}

        <section aria-labelledby="profile-posts-heading" className="grid gap-4 max-md:grid-cols-1">
          <div className="flex items-baseline justify-between gap-4 px-1">
            <h2 id="profile-posts-heading" className="text-lg font-bold text-navy-950">Posts</h2>
            <span className="text-sm text-muted">{posts.length} published</span>
          </div>
          {posts.length ? (
            <div className="space-y-4">
              {posts.map((post, index) => <PostCard key={post.id} post={post} readOnly={!viewer} loadingPriority={postLoadingPriority(index)} />)}
            </div>
          ) : (
            <div className="rounded-[var(--radius-card)] border border-dashed border-mist-100 bg-white px-6 py-8 text-center text-sm text-muted">
              No posts published yet.
            </div>
          )}
        </section>

        <p className="px-1 text-center text-xs leading-5 text-muted max-md:hidden">
          Sea N Shore professional profiles are member-provided. Verification badges will appear only after the formal evidence review workflow is enabled.
        </p>
      </div>

      {viewer ? (
        // Phones: People you may know lives on the Network tab.
        <aside className="min-w-0 max-md:hidden lg:sticky lg:top-24 lg:self-start lg:max-h-[calc(100vh-7rem)] lg:overflow-y-auto lg:[scrollbar-width:none] lg:[&::-webkit-scrollbar]:hidden">
          {similarPeople.length ? (
            <div className="mb-4">
              <PeopleYouMayKnow profiles={similarPeople} title={`People similar to ${profile.fullName}`} emptyState={false} />
            </div>
          ) : null}
          <PeopleYouMayKnow profiles={recommendations} excludeProfileId={profile.id} />
          <RailFooter visibleFrom="lg" />
        </aside>
      ) : (
        <div
          data-testid="public-profile-join-bar"
          className="fixed inset-x-0 bottom-0 z-40 flex items-center gap-3 border-t border-mist-100 bg-white px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] pt-3 shadow-[0_-6px_18px_rgb(7_27_45/0.08)] md:hidden"
        >
          <p className="min-w-0 flex-1 text-sm font-medium leading-5 text-navy-950">
            See {profile.fullName}&apos;s full network on Sea N Shore
          </p>
          <Link
            href={authHrefWithReturn('/auth/sign-up', `/people/${profile.slug}`)}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-full bg-ocean-700 px-5 text-[15px] font-semibold text-white hover:bg-ocean-800 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
          >
            Join Sea N Shore
          </Link>
        </div>
      )}
    </main>
  )

  // The (public) layout mounts the realtime provider for signed-in viewers.
  return profileContent
}

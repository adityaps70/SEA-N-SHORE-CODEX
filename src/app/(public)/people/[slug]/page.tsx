import { notFound } from 'next/navigation'
import { getVerifiedUser } from '@/features/auth/queries'
import { PostCard } from '@/features/feed/components/post-card'
import { getPublicPostsByAuthor } from '@/features/feed/queries'
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

  const [relationship, portfolio, recommendations, posts] = await Promise.all([
    viewer && viewer.id !== profile.id ? getRelationshipState(profile.id) : null,
    getProfilePortfolioById(profile.id),
    viewer ? getPeopleYouMayKnow(3) : Promise.resolve([]),
    getPublicPostsByAuthor(profile.id),
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

        <section aria-labelledby="profile-posts-heading" className="grid gap-4">
          <div className="flex items-end justify-between gap-4 px-1">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Activity</p>
              <h2 id="profile-posts-heading" className="mt-1 text-2xl font-semibold tracking-[-.025em] text-navy-950">Posts</h2>
            </div>
            <span className="text-sm text-muted">{posts.length} published</span>
          </div>
          {posts.length ? (
            <div className="space-y-4">
              {posts.map((post) => <PostCard key={post.id} post={post} readOnly={!viewer} />)}
            </div>
          ) : (
            <div className="rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-8 text-center text-sm text-muted">
              No posts published yet.
            </div>
          )}
        </section>

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

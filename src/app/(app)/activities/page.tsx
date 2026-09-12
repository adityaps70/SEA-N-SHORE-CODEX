import Link from 'next/link'
import { redirect } from 'next/navigation'
import { BriefcaseBusiness, MapPin, MessageSquareText, PenSquare } from 'lucide-react'
import { PremiumPageHero } from '@/components/product/premium-page-hero'
import { Card } from '@/components/ui/card'
import { CommentActivityCard } from '@/features/feed/components/comment-activity-card'
import { FeedProfileCard } from '@/features/feed/components/feed-profile-card'
import { PostCard } from '@/features/feed/components/post-card'
import { getMyActivityPosts, getMyCommentActivity } from '@/features/feed/queries'
import { JobApplicationList } from '@/features/jobs/components/job-application-list'
import { getMyJobApplications, getPublishedJobs } from '@/features/jobs/queries'
import { PeopleYouMayKnow } from '@/features/network/components/people-you-may-know'
import { getPeopleYouMayKnow } from '@/features/network/queries'
import { getOwnProfile } from '@/features/profiles/queries'

function EmptyPosts({ mode }: { mode: 'posts' | 'comments' }) {
  return (
    <div className="rounded-[1.5rem] border border-dashed border-mist-100 bg-white px-6 py-10 text-center">
      <p className="font-semibold text-navy-950">
        {mode === 'posts' ? 'You have not published a post yet.' : 'You have not commented on a post yet.'}
      </p>
      <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-muted">
        {mode === 'posts'
          ? 'Share an update, question, lesson or professional insight with the maritime community.'
          : 'Join a discussion on the home feed and the post will appear here with your comment highlighted.'}
      </p>
      <Link href="/home" className="mt-4 inline-flex min-h-10 items-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white">
        Go to home feed
      </Link>
    </div>
  )
}

type ActivityTab = 'posts' | 'comments' | 'jobs'

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: rawTab } = await searchParams
  const tab: ActivityTab = rawTab === 'comments' ? 'comments' : rawTab === 'jobs' ? 'jobs' : 'posts'

  const [profile, recommendations, jobs, posts, comments, applications] = await Promise.all([
    getOwnProfile(),
    getPeopleYouMayKnow(4),
    getPublishedJobs(),
    tab === 'posts' ? getMyActivityPosts() : Promise.resolve([]),
    tab === 'comments' ? getMyCommentActivity() : Promise.resolve([]),
    tab === 'jobs' ? getMyJobApplications() : Promise.resolve([]),
  ])
  if (!profile) redirect('/onboarding')

  const tabClass = (active: boolean) => `inline-flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-1.5 text-[11px] font-semibold transition sm:min-h-11 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm ${active ? 'bg-white text-navy-950 shadow-sm' : 'text-white/75 hover:bg-white/10 hover:text-white'}`

  return (
    <section className="grid gap-5 py-2 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_300px] xl:gap-6">
      <aside className="hidden lg:block">
        <div className="sticky top-24">
          <FeedProfileCard profile={profile} />
        </div>
      </aside>

      <main className="min-w-0">
        <div className="mb-4 lg:hidden">
          <FeedProfileCard profile={profile} compact />
        </div>

        <PremiumPageHero
          eyebrow="Member workspace"
          title="My Activities"
          description="Review what you have shared, revisit conversations you joined, and follow the status of every maritime job application."
        >
          <nav aria-label="Activity sections" className="mt-6 grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/10 p-1.5 sm:max-w-xl">
            <Link href="/activities?tab=posts" aria-current={tab === 'posts' ? 'page' : undefined} className={tabClass(tab === 'posts')}>
              <PenSquare aria-hidden="true" className="size-4" />
              <span>My Posts</span>
            </Link>
            <Link href="/activities?tab=comments" aria-current={tab === 'comments' ? 'page' : undefined} className={tabClass(tab === 'comments')}>
              <MessageSquareText aria-hidden="true" className="size-4" />
              <span>My Comments</span>
            </Link>
            <Link href="/activities?tab=jobs" aria-current={tab === 'jobs' ? 'page' : undefined} className={tabClass(tab === 'jobs')}>
              <BriefcaseBusiness aria-hidden="true" className="size-4" />
              <span>Jobs Applied</span>
            </Link>
          </nav>
        </PremiumPageHero>

        <section aria-labelledby="activity-panel-heading" className="mt-5">
          <h2 id="activity-panel-heading" className="sr-only">
            {tab === 'posts' ? 'My Posts' : tab === 'comments' ? 'My Comments' : 'Jobs Applied'}
          </h2>
          {tab === 'posts' ? (
            posts.length ? <div className="space-y-4">{posts.map((post) => <PostCard key={post.id} post={post} />)}</div> : <EmptyPosts mode="posts" />
          ) : tab === 'comments' ? (
            comments.length ? <div className="space-y-5">{comments.map((item) => <CommentActivityCard key={item.post.id} activity={item} />)}</div> : <EmptyPosts mode="comments" />
          ) : (
            <JobApplicationList applications={applications} />
          )}
        </section>
      </main>

      <aside className="hidden min-w-0 xl:block">
        <div className="sticky top-24 space-y-4">
          <Card className="border border-mist-100 p-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Career</p>
                <h2 className="mt-1 text-lg font-semibold text-navy-950">Apply to jobs</h2>
              </div>
              <BriefcaseBusiness aria-hidden="true" className="size-5 text-ocean-700" />
            </div>
            <div className="mt-3 space-y-2.5">
              {jobs.slice(0, 3).map((job) => (
                <Link key={job.id} href={`/jobs/${job.id}`} className="block rounded-xl border border-mist-100 p-3 transition hover:border-ocean-200 hover:bg-ocean-50/40">
                  <p className="text-sm font-semibold leading-5 text-navy-950">{job.title}</p>
                  <p className="mt-1 text-xs text-muted">{job.companyName}</p>
                  {job.location ? <p className="mt-1 flex items-center gap-1 text-xs text-muted"><MapPin aria-hidden="true" className="size-3" />{job.location}</p> : null}
                </Link>
              ))}
              {!jobs.length ? <p className="text-sm text-muted">No open jobs right now.</p> : null}
            </div>
            <Link href="/jobs" className="mt-3 inline-flex text-sm font-semibold text-ocean-700 hover:text-navy-950">View all jobs →</Link>
          </Card>

          <PeopleYouMayKnow profiles={recommendations} />
        </div>
      </aside>
    </section>
  )
}

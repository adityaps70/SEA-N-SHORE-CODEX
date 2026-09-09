import Link from 'next/link'
import { BriefcaseBusiness, History, MessageSquareText, PenSquare } from 'lucide-react'
import { CommentActivityCard } from '@/features/feed/components/comment-activity-card'
import { PostCard } from '@/features/feed/components/post-card'
import { getMyActivityPosts, getMyCommentActivity } from '@/features/feed/queries'
import { JobApplicationList } from '@/features/jobs/components/job-application-list'
import { getMyJobApplications } from '@/features/jobs/queries'

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

  const posts = tab === 'posts' ? await getMyActivityPosts() : []
  const comments = tab === 'comments' ? await getMyCommentActivity() : []
  const applications = tab === 'jobs' ? await getMyJobApplications() : []

  const tabClass = (active: boolean) => `inline-flex min-h-12 flex-col items-center justify-center gap-1 rounded-xl px-1.5 text-[11px] font-semibold sm:min-h-11 sm:flex-row sm:gap-2 sm:px-4 sm:text-sm ${active ? 'bg-white text-navy-950 shadow-sm' : 'text-muted hover:text-navy-950'}`

  return (
    <section className="py-2 sm:py-5">
      <div className="rounded-[1.75rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-8">
        <div className="flex items-start gap-4">
          <div className="grid size-12 shrink-0 place-items-center rounded-2xl bg-navy-950 text-white">
            <History aria-hidden="true" className="size-5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.14em] text-ocean-700">Member workspace</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-[-.035em] text-navy-950">My Activities</h1>
            <p className="mt-2 max-w-2xl leading-7 text-muted">Review what you have shared, revisit conversations you joined, and follow the status of every maritime job application.</p>
          </div>
        </div>

        <nav aria-label="Activity sections" className="mt-6 grid grid-cols-3 gap-2 rounded-2xl bg-mist-50 p-1.5 sm:max-w-xl">
          <Link
            href="/activities?tab=posts"
            aria-current={tab === 'posts' ? 'page' : undefined}
            className={tabClass(tab === 'posts')}
          >
            <PenSquare aria-hidden="true" className="size-4" />
            <span>My Posts</span>
          </Link>
          <Link
            href="/activities?tab=comments"
            aria-current={tab === 'comments' ? 'page' : undefined}
            className={tabClass(tab === 'comments')}
          >
            <MessageSquareText aria-hidden="true" className="size-4" />
            <span>My Comments</span>
          </Link>
          <Link
            href="/activities?tab=jobs"
            aria-current={tab === 'jobs' ? 'page' : undefined}
            className={tabClass(tab === 'jobs')}
          >
            <BriefcaseBusiness aria-hidden="true" className="size-4" />
            <span>Jobs Applied</span>
          </Link>
        </nav>
      </div>

      <section aria-labelledby="activity-panel-heading" className="mt-5">
        <h2 id="activity-panel-heading" className="sr-only">
          {tab === 'posts' ? 'My Posts' : tab === 'comments' ? 'My Comments' : 'Jobs Applied'}
        </h2>

        {tab === 'posts' ? (
          posts.length ? (
            <div className="space-y-4">
              {posts.map((post) => <PostCard key={post.id} post={post} />)}
            </div>
          ) : <EmptyPosts mode="posts" />
        ) : tab === 'comments' ? (
          comments.length ? (
            <div className="space-y-5">
              {comments.map((item) => <CommentActivityCard key={item.post.id} activity={item} />)}
            </div>
          ) : <EmptyPosts mode="comments" />
        ) : (
          <JobApplicationList applications={applications} />
        )}
      </section>
    </section>
  )
}

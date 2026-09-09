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

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: rawTab } = await searchParams
  const tab: 'posts' | 'comments' = rawTab === 'comments' ? 'comments' : 'posts'
  const applicationsPromise = getMyJobApplications()
  const activity = tab === 'comments' ? await getMyCommentActivity() : await getMyActivityPosts()
  const applications = await applicationsPromise

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

        <nav aria-label="Post activity" className="mt-6 grid grid-cols-2 gap-2 rounded-2xl bg-mist-50 p-1.5 sm:max-w-md">
          <Link
            href="/activities?tab=posts"
            aria-current={tab === 'posts' ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold ${tab === 'posts' ? 'bg-white text-navy-950 shadow-sm' : 'text-muted hover:text-navy-950'}`}
          >
            <PenSquare aria-hidden="true" className="size-4" /> My Posts
          </Link>
          <Link
            href="/activities?tab=comments"
            aria-current={tab === 'comments' ? 'page' : undefined}
            className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold ${tab === 'comments' ? 'bg-white text-navy-950 shadow-sm' : 'text-muted hover:text-navy-950'}`}
          >
            <MessageSquareText aria-hidden="true" className="size-4" /> My Comments
          </Link>
        </nav>
      </div>

      <section aria-labelledby="post-activity-heading" className="mt-5">
        <h2 id="post-activity-heading" className="sr-only">{tab === 'posts' ? 'My Posts' : 'My Comments'}</h2>
        {tab === 'posts' ? (
          activity.length ? (
            <div className="space-y-4">
              {activity.map((post) => 'post' in post ? null : <PostCard key={post.id} post={post} />)}
            </div>
          ) : <EmptyPosts mode="posts" />
        ) : (
          activity.length ? (
            <div className="space-y-5">
              {activity.map((item) => 'post' in item ? <CommentActivityCard key={item.post.id} activity={item} /> : null)}
            </div>
          ) : <EmptyPosts mode="comments" />
        )}
      </section>

      <section aria-labelledby="jobs-applied-heading" className="mt-8">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-navy-950 text-white">
            <BriefcaseBusiness aria-hidden="true" className="size-4.5" />
          </div>
          <div>
            <p className="text-xs font-semibold uppercase tracking-[.12em] text-ocean-700">Career activity</p>
            <h2 id="jobs-applied-heading" className="text-xl font-semibold tracking-[-.02em] text-navy-950">Jobs Applied</h2>
          </div>
        </div>
        <JobApplicationList applications={applications} />
      </section>
    </section>
  )
}

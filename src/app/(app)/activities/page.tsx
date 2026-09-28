import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { ReactNode } from 'react'
import { ArrowRight, BookOpenCheck, BriefcaseBusiness, CalendarDays, EyeOff, MapPin, MessageSquareText, PenSquare, Trash2, type LucideIcon } from 'lucide-react'
import { PremiumPageHero } from '@/components/product/premium-page-hero'
import { ActivityTabs } from './activity-tabs'
import { RailFooter } from '@/components/navigation/rail-footer'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { Card } from '@/components/ui/card'
import { EventCard } from '@/features/events/components/event-card'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { CommentActivityCard } from '@/features/feed/components/comment-activity-card'
import { FeedProfileCard } from '@/features/feed/components/feed-profile-card'
import { HiddenPostCard } from '@/features/feed/components/hidden-post-card'
import { PostCard } from '@/features/feed/components/post-card'
import { RecentlyDeletedPostCard } from '@/features/feed/components/recently-deleted-post-card'
import { getMyActivityPosts, getMyCommentActivity, getMyHiddenPosts, getMyRecentlyDeletedPosts } from '@/features/feed/queries'
import { JobApplicationList } from '@/features/jobs/components/job-application-list'
import { enrollmentRepository } from '@/features/learning/enrollment-repository'
import { getMyJobApplications, getPublishedJobs } from '@/features/jobs/queries'
import { PeopleYouMayKnow } from '@/features/network/components/people-you-may-know'
import { getPeopleYouMayKnow } from '@/features/network/queries'
import { getOwnProfilePortfolio } from '@/features/profiles/profile-portfolio-queries'
import { getOwnProfile } from '@/features/profiles/queries'

export const metadata: Metadata = { title: 'My Activities' }

function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon: LucideIcon
  title: string
  children?: ReactNode
  action?: { href: string; label: string }
}) {
  return (
    <div className="rounded-2xl border border-dashed border-mist-200 bg-white px-6 py-10 text-center">
      <span className="mx-auto grid size-11 place-items-center rounded-xl bg-mist-50 text-navy-700">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <p className="mt-3 font-semibold text-navy-950">{title}</p>
      {children ? <p className="mx-auto mt-1.5 max-w-lg text-sm leading-6 text-muted">{children}</p> : null}
      {action ? (
        <Link href={action.href} className="mt-4 inline-flex min-h-10 cursor-pointer items-center rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition hover:bg-navy-800">
          {action.label}
        </Link>
      ) : null}
    </div>
  )
}

function SectionHeading({ title, link }: { title: string; link: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <h3 className="text-base font-bold text-navy-950">{title}</h3>
      <Link href={link.href} className="inline-flex items-center gap-1 text-sm font-semibold text-ocean-700 hover:underline">
        {link.label} <ArrowRight aria-hidden="true" className="size-3.5" />
      </Link>
    </div>
  )
}

const ACTIVITY_TABS: ReadonlyArray<{ id: ActivityTab; label: string; heading: string }> = [
  { id: 'posts', label: 'Posts', heading: 'My Posts' },
  { id: 'comments', label: 'Comments', heading: 'My Comments' },
  { id: 'jobs', label: 'Jobs Applied', heading: 'Jobs Applied' },
  { id: 'events', label: 'Events', heading: 'My Events' },
  { id: 'learning', label: 'Learning', heading: 'My Learning' },
  { id: 'hidden', label: 'Hidden Posts', heading: 'Hidden Posts' },
  { id: 'deleted', label: 'Recently Deleted', heading: 'Recently Deleted' },
]

type ActivityTab = 'posts' | 'comments' | 'jobs' | 'events' | 'learning' | 'hidden' | 'deleted'

export default async function ActivitiesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>
}) {
  const { tab: rawTab } = await searchParams
  const tab: ActivityTab = ACTIVITY_TABS.find((item) => item.id === rawTab)?.id ?? 'posts'

  const user = await requireAwsUser()
  const [profile, recommendations, jobs, posts, comments, applications, deletedPosts, hiddenPosts, portfolio, attendingEvents, hostedEvents, learning] = await Promise.all([
    getOwnProfile(),
    getPeopleYouMayKnow(4),
    getPublishedJobs(),
    tab === 'posts' ? getMyActivityPosts() : Promise.resolve([]),
    tab === 'comments' ? getMyCommentActivity() : Promise.resolve([]),
    tab === 'jobs' ? getMyJobApplications() : Promise.resolve([]),
    tab === 'deleted' ? getMyRecentlyDeletedPosts() : Promise.resolve([]),
    tab === 'hidden' ? getMyHiddenPosts() : Promise.resolve([]),
    getOwnProfilePortfolio(),
    tab === 'events' ? calendarEventRepository.listMyEvents(user.id) : Promise.resolve([]),
    tab === 'events' ? calendarEventRepository.listHostedEvents(user.id) : Promise.resolve([]),
    tab === 'learning' ? enrollmentRepository.listLearnerEnrollments(user.id) : Promise.resolve([]),
  ])
  if (!profile) redirect('/onboarding')

  const portfolioCompletion = {
    experienceCount: portfolio.experiences.length,
    credentialCount: portfolio.credentials.length,
  }
  const activeTab = ACTIVITY_TABS.find((item) => item.id === tab) ?? ACTIVITY_TABS[0]

  return (
    <section className="grid gap-5 py-2 lg:grid-cols-[260px_minmax(0,1fr)] xl:grid-cols-[260px_minmax(0,1fr)_300px] xl:gap-6">
      <aside className="hidden lg:block">
        <div className="sticky top-24">
          <FeedProfileCard profile={profile} portfolioCompletion={portfolioCompletion} />
        </div>
      </aside>

      <main className="min-w-0">
        <div className="mb-4 lg:hidden">
          <FeedProfileCard profile={profile} portfolioCompletion={portfolioCompletion} compact />
        </div>

        <PremiumPageHero
          eyebrow="Member workspace"
          title="My Activities"
          description="Your posts, comments, applications, events, courses, hidden and recently deleted posts in one place."
        />

        <ActivityTabs tabs={ACTIVITY_TABS.map((item) => ({ id: item.id, label: item.label, href: `/activities?tab=${item.id}` }))} activeId={tab} />

        <section aria-labelledby="activity-panel-heading" className="mt-4">
          <h2 id="activity-panel-heading" className="sr-only">{activeTab.heading}</h2>
          {tab === 'posts' ? (
            posts.length ? <div className="space-y-4">{posts.map((post) => <PostCard key={post.id} post={post} />)}</div> : (
              <EmptyState icon={PenSquare} title="You have not published a post yet." action={{ href: '/home', label: 'Go to home feed' }}>
                Share an update, question, lesson or professional insight with the maritime community.
              </EmptyState>
            )
          ) : tab === 'comments' ? (
            comments.length ? <div className="space-y-4">{comments.map((item) => <CommentActivityCard key={item.post.id} activity={item} />)}</div> : (
              <EmptyState icon={MessageSquareText} title="You have not commented on a post yet." action={{ href: '/home', label: 'Go to home feed' }}>
                Join a discussion on the home feed and the post will appear here with your comment highlighted.
              </EmptyState>
            )
          ) : tab === 'jobs' ? (
            <JobApplicationList applications={applications} />
          ) : tab === 'events' ? (
            <div className="space-y-6">
              <section aria-label="Events you are attending" className="space-y-3">
                <SectionHeading title="Attending" link={{ href: '/events/my', label: 'Open My Events' }} />
                {attendingEvents.length ? <div className="grid gap-4 md:grid-cols-2">{attendingEvents.map((event) => <EventCard key={event.id} event={event} showStatus />)}</div> : (
                  <EmptyState icon={CalendarDays} title="You are not attending an upcoming event yet." action={{ href: '/events', label: 'Discover events' }} />
                )}
              </section>
              <section aria-label="Events you are hosting" className="space-y-3">
                <SectionHeading title="Hosting" link={{ href: '/events/hosting', label: 'Manage hosted events' }} />
                {hostedEvents.length ? <div className="grid gap-4 md:grid-cols-2">{hostedEvents.slice(0, 6).map((event) => <EventCard key={event.id} event={event} showStatus />)}</div> : (
                  <EmptyState icon={CalendarDays} title="You have not hosted an event yet." />
                )}
              </section>
            </div>
          ) : tab === 'learning' ? (
            learning.length ? (
              <div className="space-y-4">
                {learning.map((course) => (
                  <article key={course.enrollmentId} className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-bold uppercase tracking-[0.12em] text-ocean-700">{course.category}</p>
                        <h3 className="mt-1 text-lg font-bold text-navy-950">{course.title}</h3>
                        <p className="mt-1 text-sm text-muted">Published by {course.mentorName}</p>
                      </div>
                      <span className="rounded-full bg-mist-50 px-2.5 py-1 text-xs font-bold text-navy-900">{course.progressPercent}% complete</span>
                    </div>
                    <div className="mt-4 h-2 overflow-hidden rounded-full bg-mist-100"><div className="h-full rounded-full bg-ocean-600" style={{ width: `${course.progressPercent}%` }} /></div>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <Link href={`/learn/courses/${course.slug}/learn`} className="cursor-pointer rounded-xl bg-navy-950 px-4 py-2 text-sm font-bold text-white transition hover:bg-navy-800">Continue learning</Link>
                      <Link href="/learn" className="cursor-pointer rounded-xl border border-mist-200 px-4 py-2 text-sm font-bold text-navy-950 transition hover:bg-mist-50">Browse courses</Link>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <EmptyState icon={BookOpenCheck} title="No course enrollments yet." action={{ href: '/learn', label: 'Explore Learning' }}>
                Courses you join appear here with your progress, so you can pick up where you left off.
              </EmptyState>
            )
          ) : tab === 'hidden' ? (
            hiddenPosts.length ? (
              <div className="space-y-3">
                <p className="text-sm text-muted">Posts you hid stay out of your feed and organization pages. Unhide one to see it there again.</p>
                {hiddenPosts.map((post) => <HiddenPostCard key={post.id} post={post} />)}
              </div>
            ) : (
              <EmptyState icon={EyeOff} title="You have not hidden any posts." action={{ href: '/home', label: 'Go to home feed' }}>
                When you hide a post from the ⋯ menu, it appears here so you can bring it back whenever you like.
              </EmptyState>
            )
          ) : deletedPosts.length ? (
            <div className="space-y-4">{deletedPosts.map((post) => <RecentlyDeletedPostCard key={post.id} post={post} />)}</div>
          ) : (
            <EmptyState icon={Trash2} title="No recently deleted posts.">
              Posts you delete yourself remain recoverable here for 30 days before they are permanently removed.
            </EmptyState>
          )}
        </section>
      </main>

      <aside className="hidden min-w-0 xl:block">
        <div className="sticky top-24 max-h-[calc(100vh-7rem)] space-y-4 overflow-y-auto pr-1">
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
                <Link key={job.id} href={`/jobs/${job.id}`} className="block rounded-xl border border-mist-200 p-3 transition hover:border-ocean-200 hover:bg-ocean-50/40">
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
          <RailFooter visibleFrom="xl" />
        </div>
      </aside>
    </section>
  )
}

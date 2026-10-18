import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { backLinkClass } from '@/components/ui/interactive-styles'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { createLearningEmailPreferences } from '@/features/learning/learning-email-sending'
import { LearningEmailToggle } from './learning-email-toggle'
import { RankingEmailToggle } from './ranking-email-toggle'
import { createRankingEmailPreferences } from '@/features/ranking/ranking-email-sending'
import { memberTimeZoneRepository } from '@/features/learning/sessions/member-time-zone'
import { TimeZoneSetting } from '@/features/learning/sessions/components/time-zone-setting'
import { createNotificationEmailPreferences } from '@/features/notification-emails/preferences'
import { NOTIFICATION_EMAIL_DEFAULTS, NOTIFICATION_EMAIL_KINDS } from '@/features/notification-emails/kinds'
import { NotificationEmailToggle } from './notification-email-toggle'

export const metadata: Metadata = { title: 'Email notifications · Settings' }
export const dynamic = 'force-dynamic'

const preferences = createLearningEmailPreferences()
const topicPreferences = createRankingEmailPreferences()
const activityPreferences = createNotificationEmailPreferences()

/** Settings → Email notifications (learning round A): which notifications also come by email. */
export default async function EmailNotificationsPage() {
  const user = await requireAwsUser()
  const [activity, learningEnabled, topics, timeZone] = await Promise.all([
    // Round H (H3): before migration 0088 there are no switch columns; show the defaults (on).
    activityPreferences.get(user.id).catch(() => ({ ...NOTIFICATION_EMAIL_DEFAULTS })),
    preferences.learningEmailsEnabled(user.id),
    // Round G: before migration 0085 there is no topic table; show the defaults (on).
    topicPreferences.topics(user.id).catch(() => ({ job_alerts: true, weekly_digest: true })),
    memberTimeZoneRepository.get(user.id).catch(() => ({ timeZone: null, source: 'auto' as const })),
  ])

  return (
    <div className="mx-auto w-full max-w-page-narrow space-y-6 py-2 max-md:space-y-3 max-md:py-0 sm:py-5">
      <MobilePageBar backHref="/settings" title="Email notifications" />
      <header className="max-md:hidden">
        <Link href="/settings" className={backLinkClass}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Settings
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">Email notifications</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Choose which updates also come to your email. Everything still appears in Notifications on Sea N Shore.
        </p>
      </header>
      <p className="text-sm leading-6 text-muted md:hidden">Everything still appears in Notifications on Sea N Shore.</p>
      <section aria-labelledby="activity-emails-heading" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:px-4 max-md:shadow-none">
        <h2 id="activity-emails-heading" className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700">Messages and activity</h2>
        <div className="mt-2 divide-y divide-mist-100">
          {NOTIFICATION_EMAIL_KINDS.map((kind) => (
            <div key={kind} className="py-2 first:pt-0 last:pb-0">
              <NotificationEmailToggle kind={kind} initiallyEnabled={activity[kind]} />
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted">Each of these emails has a link that turns that kind of email off. Nothing is emailed about your own actions or about people you have blocked.</p>
      </section>
      <section aria-label="Jobs" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:px-4 max-md:shadow-none">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700">Jobs</h2>
        <div className="mt-2">
          <RankingEmailToggle
            topic="job_alerts"
            title="Job alert emails"
            description="New jobs that match your job alerts and your profile, daily or weekly as each alert is set. At most 10 jobs an email, and nothing when nothing new matches."
            onText="Job alert emails are on."
            offText="Job alert emails are off. Matches still appear in Notifications."
            initiallyEnabled={topics.job_alerts}
          />
        </div>
      </section>
      <section aria-label="Weekly digest" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:px-4 max-md:shadow-none">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700">Weekly digest</h2>
        <div className="mt-2">
          <RankingEmailToggle
            topic="weekly_digest"
            title="Weekly digest email"
            description="On Monday morning: posts you missed, jobs and people for you, upcoming events and a course. Only sent when there are at least 3 things worth your time."
            onText="The weekly digest is on."
            offText="The weekly digest is off."
            initiallyEnabled={topics.weekly_digest}
          />
        </div>
      </section>
      <section aria-label="Learning" className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:px-4 max-md:shadow-none">
        <h2 className="text-xs font-bold uppercase tracking-[0.15em] text-teal-700">Learning</h2>
        <div className="mt-2">
          <LearningEmailToggle initiallyEnabled={learningEnabled} />
        </div>
        <div className="mt-5 border-t border-mist-100 pt-5">
          <TimeZoneSetting initialSource={timeZone.source} initialZone={timeZone.timeZone} />
        </div>
      </section>
      <p className="text-sm leading-6 text-muted max-md:px-0">
        The newsletter has its own settings: <Link href="/newsletter" className="font-semibold text-ocean-700 hover:underline">Newsletter</Link>.
      </p>
    </div>
  )
}

import { Megaphone } from 'lucide-react'
import type { ManagedCourseAnnouncements } from '../course-announcement-repository'
import { CourseAnnouncementComposer } from './course-announcement-composer'
import { CourseAnnouncementsList } from './course-announcements-list'

/**
 * Learning round C (C5b): Studio → course → Announcements. Posting goes to the live course (also from a draft
 * revision's edit page), so learners keep hearing from the trainer while changes wait for review.
 */
export function CourseAnnouncementsPanel({ data }: { data: ManagedCourseAnnouncements }) {
  const { remainingToday } = data
  return (
    <section aria-labelledby="course-announcements-heading" className="rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] max-md:rounded-none max-md:border-x-0 max-md:p-4 max-md:shadow-none sm:p-8">
      <p className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.18em] text-teal-700">
        <Megaphone aria-hidden="true" className="size-4" /> Announcements
      </p>
      <h2 id="course-announcements-heading" className="mt-2 text-2xl font-bold text-navy-950 max-md:text-xl">Message everyone enrolled</h2>
      <p className="mt-2 max-w-3xl text-sm leading-6 text-muted">
        Share news, live session times or reminders. Learners see announcements in the course player and get a notification and an email.
        You can send up to 3 per course in 24 hours{remainingToday < 3 ? `; ${remainingToday} left right now` : ''}.
      </p>

      <div className="mt-5">
        {remainingToday > 0 ? (
          <CourseAnnouncementComposer courseId={data.liveCourseId} />
        ) : (
          <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900">
            You’ve sent 3 announcements in the last 24 hours. You can send the next one when the oldest of them is a day old.
          </p>
        )}
      </div>

      <h3 className="mt-7 text-sm font-bold uppercase tracking-[0.12em] text-muted">Sent announcements</h3>
      <div className="mt-3">
        <CourseAnnouncementsList announcements={data.announcements} showRecipients emptyText="Nothing sent yet. Your announcements will be listed here." />
      </div>
    </section>
  )
}

import { Megaphone } from 'lucide-react'
import type { CourseAnnouncement } from '../course-announcement-repository'

/** Learning round C (C5b): a course's announcements, newest first (player tab and Studio panel). */

export function formatAnnouncementDate(value: string) {
  return new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' }).format(new Date(value))
}

export function CourseAnnouncementsList({
  announcements,
  emptyText = 'No announcements yet. When your trainer posts one, you’ll see it here and get a notification.',
  showRecipients = false,
}: {
  announcements: CourseAnnouncement[]
  emptyText?: string
  showRecipients?: boolean
}) {
  if (!announcements.length) {
    return (
      <div className="flex items-start gap-3 rounded-2xl bg-mist-50 px-4 py-4 text-sm leading-6 text-navy-900">
        <Megaphone aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-teal-700" />
        <p>{emptyText}</p>
      </div>
    )
  }
  return (
    <ol className="space-y-3">
      {announcements.map((announcement) => (
        <li key={announcement.id}>
          <article aria-labelledby={`announcement-${announcement.id}`} className="rounded-2xl border border-mist-100 bg-white p-4 sm:p-5">
            <h3 id={`announcement-${announcement.id}`} className="break-words text-base font-bold text-navy-950">{announcement.title}</h3>
            <p className="mt-1 text-xs font-semibold text-muted">
              <time dateTime={announcement.createdAt}>{formatAnnouncementDate(announcement.createdAt)}</time>
              {showRecipients && typeof announcement.recipientCount === 'number'
                ? ` · sent to ${announcement.recipientCount.toLocaleString('en-IN')} ${announcement.recipientCount === 1 ? 'learner' : 'learners'}`
                : null}
            </p>
            <p className="mt-3 whitespace-pre-wrap break-words text-[15px] leading-7 text-navy-900">{announcement.body}</p>
          </article>
        </li>
      ))}
    </ol>
  )
}

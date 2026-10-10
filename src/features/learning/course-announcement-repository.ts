import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { courseManagerAccessSql } from './course-access'
import { learnerCourseAccessSql } from './course-publication'
import { announcementExcerpt, notifyCourseAnnouncement } from './learning-notifications'

/**
 * Course announcements (learning round C, C5b). A course's managers post a short plain-text announcement to everyone
 * enrolled; each learner gets it in-app and as a Learning email (unless they turned Learning emails off), and the
 * player lists it under Announcements. Announcements always belong to the live course: a draft revision's id is
 * resolved to the course it revises. At most three announcements per course in any 24 hours, checked under a lock
 * on the live course row so two posts can never both pass the check.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

export const ANNOUNCEMENT_TITLE_MAX_LENGTH = 140
export const ANNOUNCEMENT_BODY_MAX_LENGTH = 5000
export const ANNOUNCEMENTS_PER_DAY = 3

export type CourseAnnouncement = {
  id: string
  courseId: string
  title: string
  body: string
  createdAt: string
  /** Learners it was sent to (only shown to the course's managers). */
  recipientCount?: number
}

export type ManagedCourseAnnouncements = {
  liveCourseId: string
  announcements: CourseAnnouncement[]
  /** How many more can be posted before the rolling 24-hour limit. */
  remainingToday: number
}

type AnnouncementRow = QueryResultRow & {
  id: string
  course_id: string
  title: string
  body: string
  created_at: string | Date
  recipient_count?: number | string
}

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapAnnouncement(row: AnnouncementRow, withRecipients: boolean): CourseAnnouncement {
  return {
    id: row.id,
    courseId: row.course_id,
    title: row.title,
    body: row.body,
    createdAt: iso(row.created_at),
    ...(withRecipients ? { recipientCount: Number(row.recipient_count ?? 0) } : {}),
  }
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

/** `$1` = course or draft revision id, `$2` = the actor. The live course, when the actor manages it. */
const MANAGED_LIVE_COURSE_SQL = `select course.id, course.title, course.slug
  from public.learning_courses course
  where course.id = (select coalesce(given.revision_of_course_id, given.id) from public.learning_courses given where given.id = $1)
    and course.revision_of_course_id is null
    and ${courseManagerAccessSql('course', '$2')}`

const RECENT_COUNT_SQL = `select count(*)::int as count
  from public.learning_course_announcements
  where course_id = $1 and created_at > now() - interval '24 hours'`

/**
 * Who hears an announcement: every learner with an active or completed enrolment (revoked ones never; learners whose
 * access period ended still do). Course-team access (enrolment source 'admin') is the course's own staff, not
 * learners, and members whose account is suspended or being deleted are left out.
 */
const RECIPIENTS_SQL = `select enrollment.learner_id
  from public.learning_enrollments enrollment
  inner join public.profiles learner on learner.id = enrollment.learner_id
  where enrollment.course_id = $1
    and enrollment.status in ('active', 'completed')
    and enrollment.enrollment_source <> 'admin'
    and learner.account_status::text not in ('suspended', 'deletion_requested')
  order by enrollment.learner_id`

export function createCourseAnnouncementRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  /**
   * Posts an announcement and queues its delivery in one transaction. Errors: `announcement_forbidden` (not a manager
   * of the course, or no such course) and `announcement_rate_limited` (three in the last 24 hours).
   */
  async function postAnnouncement(actorId: string, courseId: string, input: { title: string; body: string }) {
    return transaction(async (query) => {
      // The row lock serialises posts to one course: the count below cannot change until this transaction ends.
      const courses = await query(`${MANAGED_LIVE_COURSE_SQL} for update of course`, [courseId, actorId])
      const course = courses[0]
      if (!course) throw new Error('announcement_forbidden')
      const liveCourseId = String(course.id)

      const recent = await query(RECENT_COUNT_SQL, [liveCourseId])
      if (Number(recent[0]?.count ?? 0) >= ANNOUNCEMENTS_PER_DAY) throw new Error('announcement_rate_limited')

      const inserted = await query(
        `insert into public.learning_course_announcements (course_id, author_id, title, body)
         values ($1, $2, $3, $4)
         returning id, course_id, title, body, created_at, recipient_count`,
        [liveCourseId, actorId, input.title, input.body],
      ) as AnnouncementRow[]
      const announcement = inserted[0]!

      const recipients = (await query(RECIPIENTS_SQL, [liveCourseId])).map((row) => String(row.learner_id)).filter((id) => id !== actorId)
      const recipientCount = await notifyCourseAnnouncement(query, {
        announcementId: announcement.id,
        courseId: liveCourseId,
        recipientIds: recipients,
        details: {
          courseTitle: String(course.title),
          courseSlug: String(course.slug),
          announcementId: announcement.id,
          announcementTitle: input.title,
          announcementExcerpt: announcementExcerpt(input.body),
        },
      })
      await query(`update public.learning_course_announcements set recipient_count = $2 where id = $1`, [announcement.id, recipientCount])
      return mapAnnouncement({ ...announcement, recipient_count: recipientCount }, true)
    })
  }

  /** Studio: the live course's announcements (newest first) and how many more can be posted today. */
  async function listForManager(actorId: string, courseId: string, options: { limit?: number } = {}): Promise<ManagedCourseAnnouncements | null> {
    const courses = await queryRows(MANAGED_LIVE_COURSE_SQL, [courseId, actorId])
    if (!courses[0]) return null
    const liveCourseId = String(courses[0].id)
    const [rows, recent] = await Promise.all([
      queryRows(
        `select id, course_id, title, body, created_at, recipient_count
         from public.learning_course_announcements
         where course_id = $1 and removed_at is null
         order by created_at desc, id desc
         limit $2`,
        [liveCourseId, Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 100)],
      ) as Promise<AnnouncementRow[]>,
      queryRows(RECENT_COUNT_SQL, [liveCourseId]),
    ])
    return {
      liveCourseId,
      announcements: rows.map((row) => mapAnnouncement(row, true)),
      remainingToday: Math.max(0, ANNOUNCEMENTS_PER_DAY - Number(recent[0]?.count ?? 0)),
    }
  }

  /**
   * The player's Announcements tab: newest first, for a learner with an active or completed enrolment (access that
   * ended still shows them). Returns null when the learner may not see the course.
   */
  async function listForLearner(learnerId: string, courseId: string, options: { limit?: number } = {}): Promise<CourseAnnouncement[] | null> {
    const access = await queryRows(
      `select 1 as allowed
       from public.learning_enrollments enrollment
       inner join public.learning_courses course on course.id = enrollment.course_id
       left join public.learning_mentors mentor on mentor.id = course.mentor_id
       left join public.learning_mentor_applications application
         on application.id = mentor.application_id and application.user_id = mentor.user_id
       left join public.companies company on company.id = course.company_id
       where enrollment.learner_id = $1
         and enrollment.course_id = $2
         and enrollment.status in ('active', 'completed')
         and course.revision_of_course_id is null
         and ${learnerCourseAccessSql()}
       limit 1`,
      [learnerId, courseId],
    )
    if (!access[0]) return null
    const rows = await queryRows(
      `select id, course_id, title, body, created_at
       from public.learning_course_announcements
       where course_id = $1 and removed_at is null
       order by created_at desc, id desc
       limit $2`,
      [courseId, Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100)],
    ) as AnnouncementRow[]
    return rows.map((row) => mapAnnouncement(row, false))
  }

  return { postAnnouncement, listForManager, listForLearner }
}

export type CourseAnnouncementRepository = ReturnType<typeof createCourseAnnouncementRepository>
export const courseAnnouncementRepository = createCourseAnnouncementRepository()

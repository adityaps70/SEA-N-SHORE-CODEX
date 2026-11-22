import type { QueryResultRow } from 'pg'
import { actorRoleFor } from '@/features/admin/admin-audit'
import { courseCountrySql, courseReviewCountrySql } from '@/features/country-admins/item-country-sql'
import { resolveSectionScope, scopeCoversCountry } from '@/features/country-admins/scope'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { assessPlatformText, type AutomatedModerationAssessment } from '@/features/moderation/automated'
import { courseManagerAccessSql } from './course-access'
import { learnerCourseAccessSql } from './course-publication'
import { REVIEW_REPLY_MAX_LENGTH } from './course-review-reply-rules'

/**
 * Course ratings and reviews (learning round C, C5a).
 *
 * A learner rates a course (1–5 stars, an optional written review) from the player once they have completed at least
 * 20% of its published materials, with an active or completed enrolment that is not revoked and whose access has not
 * ended. One review per learner per course; editing it sends it back to Sea N Shore moderation. Only approved reviews
 * are public (course page list and average). Pending reviews wait in the "Course reviews to approve" list on the
 * admin moderation page; an approved review can be reported by members and then removed or restored through the
 * ordinary report queue (target type `course_review`).
 *
 * Round H: the course owner (anyone courseManagerAccessSql allows: the course's trainer, or an approved owner,
 * administrator or LMS manager of the publishing organization) may add, edit or delete one reply per approved
 * review; it shows under the review as "Reply from <publisher>". Administrators hide or restore a reply from the
 * moderation page; a hidden reply is never public and stays hidden through owner edits until it is restored. Every
 * reply action is written to the audit log (no names, no text).
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

export const REVIEW_MIN_PROGRESS_PERCENT = 20
export const REVIEW_BODY_MAX_LENGTH = 2000

export type CourseReviewStatus = 'pending' | 'approved' | 'rejected' | 'removed'

export type CourseReviewReplyStatus = 'visible' | 'hidden'

export type CourseReviewReply = {
  body: string
  repliedAt: string
}

/** The owner's view of a reply: hidden replies are included, with their status. */
export type OwnerCourseReviewReply = CourseReviewReply & { status: CourseReviewReplyStatus }

export type OwnerReplyView = {
  /** Owner replies by review id, hidden ones included. */
  replies: Record<string, OwnerCourseReviewReply>
}

export type CourseReviewReplyResult = {
  reviewId: string
  courseId: string
  reply: OwnerCourseReviewReply | null
}

/** One reply in the administrators' list on the moderation page. */
export type ModerationCourseReviewReply = {
  reviewId: string
  body: string
  status: CourseReviewReplyStatus
  repliedAt: string
  reviewRating: number
  reviewBody: string
  course: { id: string; title: string; slug: string }
  publisherName: string
}

export type OwnCourseReview = {
  id: string
  rating: number
  body: string
  status: CourseReviewStatus
  updatedAt: string
}

export type CourseReviewIneligibleReason = 'not_enrolled' | 'access_ended' | 'course_team' | 'progress'

export type CourseReviewEligibility = {
  canReview: boolean
  reason: CourseReviewIneligibleReason | null
  /** Completed published materials as a share of all published materials (0–100, rounded down). */
  progressPercent: number
  review: OwnCourseReview | null
}

export type PublicCourseReview = {
  id: string
  rating: number
  body: string
  reviewedAt: string
  reviewer: { id: string; name: string; slug: string | null }
  /** Round H: the owner's reply, only while it is visible. */
  reply?: CourseReviewReply | null
}

export type PublicCourseReviews = {
  averageRating: number | null
  reviewCount: number
  reviews: PublicCourseReview[]
}

export type PendingCourseReview = {
  id: string
  rating: number
  body: string
  createdAt: string
  updatedAt: string
  edited: boolean
  course: { id: string; title: string; slug: string }
  reviewer: { id: string; name: string; slug: string | null }
  screening: AutomatedModerationAssessment
}

export type CourseReviewDecision = 'approved' | 'rejected'

type EligibilityRow = QueryResultRow & {
  enrollment_id: string
  status: string
  enrollment_source: string | null
  access_ended: boolean
  is_manager: boolean
  total_lessons: string | number
  completed_lessons: string | number
}

type ReviewRow = QueryResultRow & {
  id: string
  rating: number | string
  body: string
  status: CourseReviewStatus
  updated_at: string | Date
}

type ReplyRow = QueryResultRow & {
  id: string
  course_id: string
  status?: CourseReviewStatus
  owner_reply: string | null
  owner_replied_at: string | Date | null
  owner_reply_status: CourseReviewReplyStatus
  is_manager?: boolean
}

function iso(value: string | Date) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString()
}

function mapOwnReview(row: ReviewRow): OwnCourseReview {
  return { id: row.id, rating: Number(row.rating), body: row.body, status: row.status, updatedAt: iso(row.updated_at) }
}

function mapOwnerReply(row: ReplyRow): OwnerCourseReviewReply | null {
  if (row.owner_reply === null || !row.owner_replied_at) return null
  return { body: row.owner_reply, repliedAt: iso(row.owner_replied_at), status: row.owner_reply_status }
}

function runtimeTransaction<T>(work: (query: Query) => Promise<T>) {
  return databaseTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows))
}

/**
 * The learner's enrolment in a live course with the progress the player shows: published materials in sections that
 * are not removed. `$1` is the learner, `$2` the course. `lockSuffix` locks the enrolment row while a review is saved.
 */
function eligibilitySql(lockSuffix = '') {
  return `select
       enrollment.id as enrollment_id,
       enrollment.status,
       enrollment.enrollment_source,
       (enrollment.access_expires_at is not null and enrollment.access_expires_at <= now()) as access_ended,
       ${courseManagerAccessSql('course', '$1')} as is_manager,
       (select count(lesson.id)
        from public.learning_course_sections section
        inner join public.learning_lessons lesson on lesson.section_id = section.id and lesson.is_published = true
        where section.course_id = course.id and section.removed_at is null) as total_lessons,
       (select count(progress.lesson_id)
        from public.learning_course_sections section
        inner join public.learning_lessons lesson on lesson.section_id = section.id and lesson.is_published = true
        inner join public.learning_progress progress
          on progress.lesson_id = lesson.id and progress.enrollment_id = enrollment.id and progress.completed = true
        where section.course_id = course.id and section.removed_at is null) as completed_lessons
     from public.learning_enrollments enrollment
     inner join public.learning_courses course on course.id = enrollment.course_id
     left join public.learning_mentors mentor on mentor.id = course.mentor_id
     left join public.learning_mentor_applications application
       on application.id = mentor.application_id and application.user_id = mentor.user_id
     left join public.companies company on company.id = course.company_id
     where enrollment.learner_id = $1
       and enrollment.course_id = $2
       and course.revision_of_course_id is null
       and ${learnerCourseAccessSql()}
     limit 1
     ${lockSuffix}`
}

function evaluate(row: EligibilityRow | undefined): { reason: CourseReviewIneligibleReason | null; progressPercent: number; enrollmentId: string | null } {
  if (!row || (row.status !== 'active' && row.status !== 'completed')) return { reason: 'not_enrolled', progressPercent: 0, enrollmentId: null }
  const total = Number(row.total_lessons ?? 0)
  const completed = Number(row.completed_lessons ?? 0)
  const progressPercent = total > 0 ? Math.floor((completed * 100) / total) : 0
  if (row.enrollment_source === 'admin' || row.is_manager) return { reason: 'course_team', progressPercent, enrollmentId: row.enrollment_id }
  if (row.access_ended) return { reason: 'access_ended', progressPercent, enrollmentId: row.enrollment_id }
  // At least 20% of the published materials, compared exactly (3 of 15 qualifies, 2 of 11 does not).
  if (total === 0 || completed * 100 < REVIEW_MIN_PROGRESS_PERCENT * total) return { reason: 'progress', progressPercent, enrollmentId: row.enrollment_id }
  return { reason: null, progressPercent, enrollmentId: row.enrollment_id }
}

export function createCourseRatingRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function getOwnReview(query: Query, learnerId: string, courseId: string) {
    const rows = await query(
      `select id, rating, body, status, updated_at from public.learning_course_reviews where learner_id = $1 and course_id = $2`,
      [learnerId, courseId],
    ) as ReviewRow[]
    return rows[0] ? mapOwnReview(rows[0]) : null
  }

  /** Whether the learner may rate this course now, their progress, and their review if they wrote one. */
  async function getEligibility(learnerId: string, courseId: string): Promise<CourseReviewEligibility> {
    const rows = await queryRows(eligibilitySql(), [learnerId, courseId]) as EligibilityRow[]
    const result = evaluate(rows[0])
    const review = result.enrollmentId ? await getOwnReview(queryRows, learnerId, courseId) : null
    return { canReview: result.reason === null, reason: result.reason, progressPercent: result.progressPercent, review }
  }

  /**
   * Saves the learner's rating and review, re-checking everything on the server under a lock on the enrolment.
   * A new review, and any change to an existing one, waits for moderation ('pending'); saving the same words and
   * stars again changes nothing. Text the automated screening blocks is refused (`review_blocked`).
   */
  async function saveReview(learnerId: string, courseId: string, input: { rating: number; body: string }): Promise<OwnCourseReview> {
    const body = input.body.trim()
    if (body && assessPlatformText([body]).decision === 'block') throw new Error('review_blocked')
    return transaction(async (query) => {
      const rows = await query(eligibilitySql('for update of enrollment'), [learnerId, courseId]) as EligibilityRow[]
      const result = evaluate(rows[0])
      if (result.reason === 'not_enrolled' || !result.enrollmentId) throw new Error('review_not_enrolled')
      if (result.reason === 'course_team') throw new Error('review_course_team')
      if (result.reason === 'access_ended') throw new Error('review_access_ended')
      if (result.reason === 'progress') throw new Error('review_progress_too_low')

      const saved = await query(
        `insert into public.learning_course_reviews (course_id, learner_id, enrollment_id, rating, body, status)
         values ($1, $2, $3, $4, $5, 'pending')
         on conflict (course_id, learner_id) do update
           set rating = excluded.rating,
               body = excluded.body,
               enrollment_id = excluded.enrollment_id,
               status = 'pending',
               moderated_by = null,
               moderated_at = null,
               updated_at = now()
           where public.learning_course_reviews.rating <> excluded.rating
              or public.learning_course_reviews.body <> excluded.body
         returning id, rating, body, status, updated_at`,
        [courseId, learnerId, result.enrollmentId, input.rating, body],
      ) as ReviewRow[]
      if (saved[0]) return mapOwnReview(saved[0])
      const unchanged = await getOwnReview(query, learnerId, courseId)
      if (!unchanged) throw new Error('review_not_saved')
      return unchanged
    })
  }

  /** Approved reviews of a live course for its public page: the average, the count and the newest reviews. */
  async function getPublicReviews(courseId: string, options: { limit?: number } = {}): Promise<PublicCourseReviews> {
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 20), 1), 50)
    // Reviews of members whose account is suspended or being deleted are left out of the list and the average.
    const visible = `review.course_id = $1
         and review.status = 'approved'
         and reviewer.account_status::text not in ('suspended', 'deletion_requested')`
    const [summary, rows] = await Promise.all([
      queryRows(
        `select count(*)::int as review_count, round(avg(review.rating)::numeric, 1) as average_rating
         from public.learning_course_reviews review
         inner join public.profiles reviewer on reviewer.id = review.learner_id
         where ${visible}`,
        [courseId],
      ),
      queryRows(
        `select review.id, review.rating, review.body, coalesce(review.moderated_at, review.updated_at) as reviewed_at,
                reviewer.id as reviewer_id, reviewer.full_name as reviewer_name, reviewer.slug as reviewer_slug,
                case when review.owner_reply_status = 'visible' then review.owner_reply end as owner_reply,
                case when review.owner_reply_status = 'visible' then review.owner_replied_at end as owner_replied_at
         from public.learning_course_reviews review
         inner join public.profiles reviewer on reviewer.id = review.learner_id
         where ${visible}
         order by review.updated_at desc, review.id desc
         limit $2`,
        [courseId, limit],
      ),
    ])
    const reviewCount = Number(summary[0]?.review_count ?? 0)
    return {
      reviewCount,
      averageRating: reviewCount > 0 && summary[0]?.average_rating !== null ? Number(summary[0]!.average_rating) : null,
      reviews: rows.map((row) => ({
        id: String(row.id),
        rating: Number(row.rating),
        body: String(row.body ?? ''),
        reviewedAt: iso(row.reviewed_at as string | Date),
        reviewer: { id: String(row.reviewer_id), name: String(row.reviewer_name), slug: row.reviewer_slug ? String(row.reviewer_slug) : null },
        reply: row.owner_reply ? { body: String(row.owner_reply), repliedAt: iso(row.owner_replied_at as string | Date) } : null,
      })),
    }
  }

  /** Platform administrators: reviews waiting for approval, oldest first, with the automated screening's view. */
  async function listPendingReviews(adminId: string, options: { limit?: number } = {}): Promise<PendingCourseReview[]> {
    // Round GP Part E: a country admin with Learning sees ratings of their countries' courses.
    const scope = await resolveSectionScope(queryRows, adminId, 'learning', 'view')
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100)
    const rows = await queryRows(
      `select review.id, review.rating, review.body, review.created_at, review.updated_at,
              course.id as course_id, course.title as course_title, course.slug as course_slug,
              reviewer.id as reviewer_id, reviewer.full_name as reviewer_name, reviewer.slug as reviewer_slug
       from public.learning_course_reviews review
       inner join public.learning_courses course on course.id = review.course_id
       inner join public.profiles reviewer on reviewer.id = review.learner_id
       where review.status = 'pending'
         ${scope.kind === 'country' ? `and ${courseCountrySql('course')} = any($2::text[])` : ''}
       order by review.updated_at asc, review.id asc
       limit $1`,
      scope.kind === 'country' ? [limit, scope.countries] : [limit],
    )
    return rows.map((row) => {
      const body = String(row.body ?? '')
      const createdAt = iso(row.created_at as string | Date)
      const updatedAt = iso(row.updated_at as string | Date)
      return {
        id: String(row.id),
        rating: Number(row.rating),
        body,
        createdAt,
        updatedAt,
        edited: updatedAt !== createdAt,
        course: { id: String(row.course_id), title: String(row.course_title), slug: String(row.course_slug) },
        reviewer: { id: String(row.reviewer_id), name: String(row.reviewer_name), slug: row.reviewer_slug ? String(row.reviewer_slug) : null },
        screening: assessPlatformText([body]),
      }
    })
  }

  /**
   * Approves or rejects a pending review. `expectedUpdatedAt` is the version the moderator read: a review the learner
   * changed in the meantime is refused (`review_changed`) so nobody approves words they have not seen. Recorded in
   * the audit log (no names, no review text).
   */
  async function decideReview(adminId: string, input: { reviewId: string; decision: CourseReviewDecision; note: string | null; expectedUpdatedAt?: string | null }) {
    return transaction(async (query) => {
      const scope = await resolveSectionScope(query, adminId, 'learning', 'act', { lock: true })
      const rows = await query(
        `select id, status, updated_at, course_id, ${courseReviewCountrySql('public.learning_course_reviews')} as course_country
         from public.learning_course_reviews where id = $1 for update`,
        [input.reviewId],
      ) as Array<ReviewRow & { course_id: string; course_country?: string | null }>
      const review = rows[0]
      if (!review) throw new Error('review_not_found')
      const country = review.course_country ?? null
      if (!scopeCoversCountry(scope, country)) throw new Error('learning_out_of_scope')
      if (review.status !== 'pending') throw new Error('review_not_pending')
      if (input.expectedUpdatedAt && iso(review.updated_at) !== iso(input.expectedUpdatedAt)) throw new Error('review_changed')

      await query(
        `update public.learning_course_reviews
         set status = $2, moderated_by = $3, moderated_at = now()
         where id = $1`,
        [input.reviewId, input.decision, adminId],
      )
      await query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, 'course_review', $3, $4::jsonb)`,
        [
          adminId,
          input.decision === 'approved' ? 'moderation.course_review_approved' : 'moderation.course_review_rejected',
          input.reviewId,
          JSON.stringify({ decision: input.decision, courseId: review.course_id, ...(input.note ? { note: input.note } : {}), actorRole: actorRoleFor(scope), section: 'learning', country }),
        ],
      )
      return { courseId: review.course_id, status: input.decision }
    })
  }

  /** Round H: the review and its course, locked, with whether the actor may manage the course. */
  async function lockReviewForOwner(query: Query, actorId: string, reviewId: string) {
    const rows = await query(
      `select review.id, review.course_id, review.status, review.owner_reply, review.owner_replied_at, review.owner_reply_status,
              ${courseManagerAccessSql('course', '$2')} as is_manager
       from public.learning_course_reviews review
       inner join public.learning_courses course on course.id = review.course_id
       where review.id = $1
       for update of review`,
      [reviewId, actorId],
    ) as ReplyRow[]
    const review = rows[0]
    if (!review) throw new Error('reply_review_not_found')
    if (!review.is_manager) throw new Error('reply_forbidden')
    return review
  }

  /**
   * Round H: the course owner's view of the replies on one course, hidden ones included, or null when the viewer
   * cannot reply (only course owners can).
   */
  async function getOwnerReplyView(actorId: string, courseId: string): Promise<OwnerReplyView | null> {
    const access = await queryRows(
      `select ${courseManagerAccessSql('course', '$2')} as is_manager
       from public.learning_courses course
       where course.id = $1 and course.revision_of_course_id is null`,
      [courseId, actorId],
    )
    if (!access[0]?.is_manager) return null
    const rows = await queryRows(
      `select id, owner_reply, owner_replied_at, owner_reply_status
       from public.learning_course_reviews
       where course_id = $1 and status = 'approved' and owner_reply is not null`,
      [courseId],
    ) as ReplyRow[]
    return { replies: Object.fromEntries(rows.map((row) => [row.id, mapOwnerReply(row)!])) }
  }

  /**
   * Round H: the course owner adds (`mode: 'add'`) or edits (`mode: 'edit'`) the one reply to an approved review.
   * Adding when a reply already exists is refused (`reply_exists`), so two owners never overwrite each other unseen.
   * Text the automated screening blocks is refused (`reply_blocked`). Saving the same words again changes nothing.
   */
  async function saveReply(actorId: string, input: { reviewId: string; body: string; mode: 'add' | 'edit' }): Promise<CourseReviewReplyResult> {
    const body = input.body.trim()
    if (!body || body.length > REVIEW_REPLY_MAX_LENGTH) throw new Error('reply_invalid')
    if (assessPlatformText([body]).decision === 'block') throw new Error('reply_blocked')
    return transaction(async (query) => {
      const review = await lockReviewForOwner(query, actorId, input.reviewId)
      if (review.status !== 'approved') throw new Error('reply_review_not_public')
      if (input.mode === 'add' && review.owner_reply !== null) throw new Error('reply_exists')
      if (input.mode === 'edit' && review.owner_reply === null) throw new Error('reply_not_found')
      if (review.owner_reply === body) return { reviewId: review.id, courseId: review.course_id, reply: mapOwnerReply(review) }

      const saved = await query(
        `update public.learning_course_reviews
         set owner_reply = $2, owner_replied_at = now(), owner_replied_by = $3
         where id = $1
         returning id, owner_reply, owner_replied_at, owner_reply_status`,
        [review.id, body, actorId],
      ) as ReplyRow[]
      await query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, 'course_review', $3, $4::jsonb)`,
        [
          actorId,
          input.mode === 'add' ? 'learning.course_review_reply_added' : 'learning.course_review_reply_edited',
          review.id,
          JSON.stringify({ courseId: review.course_id, replyStatus: review.owner_reply_status }),
        ],
      )
      return { reviewId: review.id, courseId: review.course_id, reply: mapOwnerReply(saved[0]!) }
    })
  }

  /** Round H: the course owner deletes the reply. A hidden reply's status is kept, so a new reply starts hidden. */
  async function deleteReply(actorId: string, input: { reviewId: string }): Promise<CourseReviewReplyResult> {
    return transaction(async (query) => {
      const review = await lockReviewForOwner(query, actorId, input.reviewId)
      if (review.owner_reply === null) throw new Error('reply_not_found')
      await query(
        `update public.learning_course_reviews
         set owner_reply = null, owner_replied_at = null, owner_replied_by = null
         where id = $1`,
        [review.id],
      )
      await query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, 'learning.course_review_reply_deleted', 'course_review', $2, $3::jsonb)`,
        [actorId, review.id, JSON.stringify({ courseId: review.course_id, replyStatus: review.owner_reply_status })],
      )
      return { reviewId: review.id, courseId: review.course_id, reply: null }
    })
  }

  /** Round H: platform administrators: the newest owner replies, visible and hidden, for the moderation page. */
  async function listReviewReplies(adminId: string, options: { limit?: number } = {}): Promise<ModerationCourseReviewReply[]> {
    const scope = await resolveSectionScope(queryRows, adminId, 'learning', 'view')
    const limit = Math.min(Math.max(Math.trunc(options.limit ?? 30), 1), 100)
    const rows = await queryRows(
      `select review.id, review.owner_reply, review.owner_replied_at, review.owner_reply_status, review.rating, review.body,
              course.id as course_id, course.title as course_title, course.slug as course_slug,
              case when course.company_id is null then application.applicant_name else company.name end as publisher_name
       from public.learning_course_reviews review
       inner join public.learning_courses course on course.id = review.course_id
       left join public.learning_mentors mentor on mentor.id = course.mentor_id
       left join public.learning_mentor_applications application
         on application.id = mentor.application_id and application.user_id = mentor.user_id
       left join public.companies company on company.id = course.company_id
       where review.owner_reply is not null
         ${scope.kind === 'country' ? `and ${courseCountrySql('course')} = any($2::text[])` : ''}
       order by review.owner_replied_at desc, review.id desc
       limit $1`,
      scope.kind === 'country' ? [limit, scope.countries] : [limit],
    )
    return rows.map((row) => ({
      reviewId: String(row.id),
      body: String(row.owner_reply),
      status: row.owner_reply_status === 'hidden' ? 'hidden' : 'visible',
      repliedAt: iso(row.owner_replied_at as string | Date),
      reviewRating: Number(row.rating),
      reviewBody: String(row.body ?? ''),
      course: { id: String(row.course_id), title: String(row.course_title), slug: String(row.course_slug) },
      publisherName: row.publisher_name ? String(row.publisher_name) : 'the course publisher',
    }))
  }

  /**
   * Round H: platform administrators hide or restore an owner reply. Recorded in the audit log like the review
   * decisions (no names, no reply text). Setting the status a reply already has is refused (`reply_status_unchanged`).
   */
  async function setReplyStatus(adminId: string, input: { reviewId: string; status: CourseReviewReplyStatus; note: string | null }) {
    return transaction(async (query) => {
      const scope = await resolveSectionScope(query, adminId, 'learning', 'act', { lock: true })
      const rows = await query(
        `select id, course_id, owner_reply, owner_reply_status, ${courseReviewCountrySql('public.learning_course_reviews')} as course_country
         from public.learning_course_reviews where id = $1 for update`,
        [input.reviewId],
      ) as Array<ReplyRow & { course_country?: string | null }>
      const review = rows[0]
      if (!review) throw new Error('reply_review_not_found')
      const country = review.course_country ?? null
      if (!scopeCoversCountry(scope, country)) throw new Error('learning_out_of_scope')
      if (review.owner_reply === null) throw new Error('reply_not_found')
      if (review.owner_reply_status === input.status) throw new Error('reply_status_unchanged')
      await query(`update public.learning_course_reviews set owner_reply_status = $2 where id = $1`, [review.id, input.status])
      await query(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
         values ($1, $2, 'course_review', $3, $4::jsonb)`,
        [
          adminId,
          input.status === 'hidden' ? 'moderation.course_review_reply_hidden' : 'moderation.course_review_reply_restored',
          review.id,
          JSON.stringify({ courseId: review.course_id, ...(input.note ? { note: input.note } : {}), actorRole: actorRoleFor(scope), section: 'learning', country }),
        ],
      )
      return { courseId: review.course_id, status: input.status }
    })
  }

  return {
    getEligibility,
    saveReview,
    getPublicReviews,
    listPendingReviews,
    decideReview,
    getOwnerReplyView,
    saveReply,
    deleteReply,
    listReviewReplies,
    setReplyStatus,
  }
}

export type CourseRatingRepository = ReturnType<typeof createCourseRatingRepository>
export const courseRatingRepository = createCourseRatingRepository()

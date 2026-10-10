import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { batchStaffAccessSql, courseManagerAccessSql } from '../course-access'
import { liveCourseSql } from '../course-publication'
import {
  BATCH_SEAT_HOLD_MINUTES,
  BATCH_STATUSES,
  batchClosedReason,
  nextBatchStatus,
  type BatchClosedReason,
  type BatchInput,
  type BatchStatus,
  type CourseBatch,
  type CourseBatchSettings,
} from './batch-rules'

/**
 * Batches (learning round D, D1): public.learning_course_batches and learning_batch_instructors (0078).
 *
 * Course managers (and platform administrators, `allCourses`) run every batch of their course; a batch's manager and
 * instructors can read that one batch and its learners. Every change is audited in audit_events with ids and counts
 * only, never a learner's name or email. Batches belong to the live course; a draft revision never touches them.
 */

type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

export type BatchActor = { actorId: string; allCourses?: boolean }

export class BatchError extends Error {
  constructor(readonly code:
    | 'course_not_found'
    | 'batch_not_found'
    | 'batch_required'
    | 'batch_mode_off'
    | 'member_not_found'
    | 'enrollment_not_found'
    | BatchClosedReason) {
    super(code)
  }
}

function clientQuery(client: DatabaseQueryClient): Query {
  return async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows
}

function iso(value: unknown) {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function count(value: unknown) {
  const numeric = Number(value ?? 0)
  return Number.isFinite(numeric) && numeric > 0 ? Math.round(numeric) : 0
}

function asStatus(value: unknown): BatchStatus {
  return (BATCH_STATUSES as readonly string[]).includes(String(value)) ? (String(value) as BatchStatus) : 'upcoming'
}

/** Seats taken in a batch: open enrolments plus checkouts for it awaiting payment (within the hold window). */
export function batchSeatCountsSql(batchAlias = 'batch') {
  return `
    (select count(*)::int from public.learning_enrollments seat_enrollment
      where seat_enrollment.batch_id = ${batchAlias}.id and seat_enrollment.status in ('active', 'completed')) as enrolled_count,
    (select count(*)::int from public.course_payment_orders seat_order
      where seat_order.batch_id = ${batchAlias}.id and seat_order.status = 'created'
        and seat_order.created_at > now() - interval '${BATCH_SEAT_HOLD_MINUTES} minutes') as held_count`
}

const BATCH_COLUMNS = `
  batch.id, batch.course_id, batch.title, batch.starts_at, batch.ends_at, batch.seat_limit, batch.time_zone, batch.status,
  batch.enrolment_open, batch.manager_profile_id, manager.full_name as manager_name,
  ${batchSeatCountsSql('batch')}`

const BATCH_FROM = `
  from public.learning_course_batches batch
  left join public.profiles manager on manager.id = batch.manager_profile_id`

export function mapBatch(row: QueryResultRow): CourseBatch {
  return {
    id: String(row.id),
    courseId: String(row.course_id),
    title: String(row.title),
    startsAt: iso(row.starts_at) ?? new Date(0).toISOString(),
    endsAt: iso(row.ends_at),
    seatLimit: row.seat_limit === null || row.seat_limit === undefined ? null : Number(row.seat_limit),
    timeZone: String(row.time_zone ?? 'Asia/Kolkata'),
    status: asStatus(row.status),
    enrolmentOpen: row.enrolment_open !== false,
    managerProfileId: row.manager_profile_id ? String(row.manager_profile_id) : null,
    managerName: row.manager_name ? String(row.manager_name).trim() || null : null,
    enrolledCount: count(row.enrolled_count),
    heldCount: count(row.held_count),
  }
}

export type BatchCourse = { id: string; title: string; slug: string; settings: CourseBatchSettings }

function mapSettings(row: QueryResultRow): CourseBatchSettings {
  return {
    batchMode: row.batch_mode === 'batches' ? 'batches' : 'self_paced',
    dripAnchor: row.drip_anchor === 'batch_start' ? 'batch_start' : 'enrolment',
    minAttendancePercent: row.min_attendance_percent === null || row.min_attendance_percent === undefined ? null : Number(row.min_attendance_percent),
  }
}

async function audit(query: Query, actorId: string, action: string, courseId: string, metadata: Record<string, unknown>) {
  await query(
    `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
     values ($1::uuid, $2, 'learning_course', $3, $4::jsonb)`,
    [actorId, action, courseId, JSON.stringify(metadata)],
  )
}

/** The live course the actor manages (course manager or platform admin), or course_not_found. */
async function loadManagedCourse(query: Query, actor: BatchActor, courseId: string, lock = false): Promise<BatchCourse> {
  const rows = await query(
    `select course.id, course.title, course.slug, course.batch_mode, course.drip_anchor, course.min_attendance_percent
     from public.learning_courses course
     where course.id = $2::uuid and ${liveCourseSql('course')}
       and ($3::boolean or ${courseManagerAccessSql('course', '$1::uuid')})${lock ? '\n     for update of course' : ''}`,
    [actor.actorId, courseId, Boolean(actor.allCourses)],
  )
  const row = rows[0]
  if (!row) throw new BatchError('course_not_found')
  return { id: String(row.id), title: String(row.title), slug: String(row.slug), settings: mapSettings(row) }
}

export type StaffBatch = { batch: CourseBatch; course: BatchCourse; canManageCourse: boolean; instructors: { profileId: string; name: string }[] }

/** A batch the actor may read: a course manager, a platform admin, or the batch's own manager or instructor. */
async function loadStaffBatch(query: Query, actor: BatchActor, batchId: string): Promise<StaffBatch> {
  const rows = await query(
    `select ${BATCH_COLUMNS},
            course.title as course_title, course.slug as course_slug, course.batch_mode, course.drip_anchor, course.min_attendance_percent,
            ($3::boolean or ${courseManagerAccessSql('course', '$1::uuid')}) as can_manage_course
     ${BATCH_FROM}
     inner join public.learning_courses course on course.id = batch.course_id
     where batch.id = $2::uuid
       and ($3::boolean or ${batchStaffAccessSql('batch', '$1::uuid')})`,
    [actor.actorId, batchId, Boolean(actor.allCourses)],
  )
  const row = rows[0]
  if (!row) throw new BatchError('batch_not_found')
  const instructors = await query(
    `select instructor.profile_id, profile.full_name
     from public.learning_batch_instructors instructor
     inner join public.profiles profile on profile.id = instructor.profile_id
     where instructor.batch_id = $1::uuid
     order by instructor.created_at`,
    [batchId],
  )
  return {
    batch: mapBatch(row),
    course: { id: String(row.course_id), title: String(row.course_title), slug: String(row.course_slug), settings: mapSettings(row) },
    canManageCourse: row.can_manage_course === true,
    instructors: instructors.map((instructor) => ({
      profileId: String(instructor.profile_id),
      name: String(instructor.full_name ?? '').trim() || 'Sea N Shore member',
    })),
  }
}

/** The member a verified email address belongs to, when exactly one does. */
async function memberByVerifiedEmail(query: Query, email: string) {
  const rows = await query(
    `select distinct account.profile_id
     from public.identity_accounts account
     where account.email_verified = true and account.email = $1
     limit 2`,
    [email.trim().toLowerCase()],
  )
  return rows.length === 1 ? String(rows[0]!.profile_id) : null
}

/**
 * Locks a batch for an enrolment or a checkout and checks it can take this learner: on the course, not archived or
 * completed, enrolment open and a seat free. `excludeOrderId` leaves the learner's own superseded checkout out of the
 * held seats. Returns the batch (still locked by the caller's transaction).
 */
export async function lockBatchForEnrolment(query: Query, input: { courseId: string; batchId: string; excludeOrderId?: string | null }) {
  const locked = await query(
    `select batch.id from public.learning_course_batches batch
     where batch.id = $1::uuid and batch.course_id = $2::uuid
     for update`,
    [input.batchId, input.courseId],
  )
  if (!locked[0]) throw new BatchError('batch_not_found')
  const rows = await query(
    `select batch.id, batch.course_id, batch.title, batch.starts_at, batch.ends_at, batch.seat_limit, batch.time_zone, batch.status,
            batch.enrolment_open, batch.manager_profile_id, null::text as manager_name,
            (select count(*)::int from public.learning_enrollments seat_enrollment
              where seat_enrollment.batch_id = batch.id and seat_enrollment.status in ('active', 'completed')) as enrolled_count,
            (select count(*)::int from public.course_payment_orders seat_order
              where seat_order.batch_id = batch.id and seat_order.status = 'created'
                and seat_order.created_at > now() - interval '${BATCH_SEAT_HOLD_MINUTES} minutes'
                and seat_order.id is distinct from $2::uuid) as held_count
     from public.learning_course_batches batch
     where batch.id = $1::uuid`,
    [input.batchId, input.excludeOrderId ?? null],
  )
  const batch = mapBatch(rows[0]!)
  const reason = batchClosedReason(batch)
  if (reason) throw new BatchError(reason)
  return batch
}

/** The course's batch mode, read inside a transaction (null when the course does not exist). */
export async function courseBatchMode(query: Query, courseId: string) {
  const rows = await query(`select batch_mode from public.learning_courses where id = $1::uuid`, [courseId])
  if (!rows[0]) return null
  return rows[0].batch_mode === 'batches' ? 'batches' as const : 'self_paced' as const
}

/**
 * Resolves the batch an enrolment or checkout should carry: null on a self-paced course (any batch id is ignored); on
 * a batch course the chosen batch, locked and checked (batch_required when none was chosen).
 */
export async function resolveEnrolmentBatch(query: Query, input: { courseId: string; batchId?: string | null; excludeOrderId?: string | null }) {
  const mode = await courseBatchMode(query, input.courseId)
  if (mode !== 'batches') return null
  if (!input.batchId) throw new BatchError('batch_required')
  return lockBatchForEnrolment(query, { courseId: input.courseId, batchId: input.batchId, excludeOrderId: input.excludeOrderId })
}

export type TeachingBatch = { batch: CourseBatch; courseTitle: string; role: 'manager' | 'instructor' }

export function createBatchRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction: Transaction = input.transaction ?? (<T>(work: (query: Query) => Promise<T>) => withTransaction((client) => work(clientQuery(client))))

  /** The Batches page: the course's settings and every batch, newest start first. */
  async function listForCourse(actor: BatchActor, courseId: string) {
    const course = await loadManagedCourse(query, actor, courseId)
    const rows = await query(
      `select ${BATCH_COLUMNS} ${BATCH_FROM}
       where batch.course_id = $1::uuid
       order by batch.starts_at desc, batch.id
       limit 200`,
      [course.id],
    )
    return { course, batches: rows.map(mapBatch) }
  }

  /** The course's mode for the course page ('self_paced' when the course is missing). */
  async function courseMode(courseId: string) {
    return (await courseBatchMode(query, courseId)) ?? 'self_paced'
  }

  async function getForStaff(actor: BatchActor, batchId: string) {
    return loadStaffBatch(query, actor, batchId)
  }

  /** Batches a learner can choose on the course page: upcoming or running, soonest first (closed ones included, marked). */
  async function listForLearners(courseId: string) {
    const rows = await query(
      `select ${BATCH_COLUMNS} ${BATCH_FROM}
       inner join public.learning_courses course on course.id = batch.course_id
       where batch.course_id = $1::uuid and course.batch_mode = 'batches'
         and batch.status in ('upcoming', 'running')
       order by batch.starts_at asc, batch.id
       limit 50`,
      [courseId],
    )
    return rows.map(mapBatch)
  }

  async function saveSettings(actor: BatchActor, courseId: string, settings: CourseBatchSettings) {
    return transaction(async (tx) => {
      const course = await loadManagedCourse(tx, actor, courseId, true)
      await tx(
        `update public.learning_courses
         set batch_mode = $2, drip_anchor = $3, min_attendance_percent = $4, updated_at = now()
         where id = $1::uuid`,
        [course.id, settings.batchMode, settings.dripAnchor, settings.minAttendancePercent],
      )
      await audit(tx, actor.actorId, 'learning.batch_settings_saved', course.id, { before: course.settings, after: settings })
      return { ...course, settings }
    })
  }

  async function create(actor: BatchActor, courseId: string, batch: BatchInput) {
    return transaction(async (tx) => {
      const course = await loadManagedCourse(tx, actor, courseId)
      const rows = await tx(
        `insert into public.learning_course_batches (course_id, title, starts_at, ends_at, seat_limit, time_zone, status, enrolment_open, created_by)
         values ($1::uuid, $2, $3::timestamptz, $4::timestamptz, $5, $6, $7, $8, $9::uuid)
         returning id`,
        [course.id, batch.title, batch.startsAt, batch.endsAt, batch.seatLimit, batch.timeZone, batch.status, batch.enrolmentOpen, actor.actorId],
      )
      const batchId = String(rows[0]!.id)
      await audit(tx, actor.actorId, 'learning.batch_created', course.id, { batchId })
      return batchId
    })
  }

  /** Edits a batch. Course managers only: batch staff run sessions, not the batch itself. */
  async function update(actor: BatchActor, batchId: string, batch: BatchInput) {
    return transaction(async (tx) => {
      const staff = await loadStaffBatch(tx, actor, batchId)
      if (!staff.canManageCourse) throw new BatchError('batch_not_found')
      await tx(
        `update public.learning_course_batches
         set title = $2, starts_at = $3::timestamptz, ends_at = $4::timestamptz, seat_limit = $5, time_zone = $6,
             status = $7, enrolment_open = $8, updated_at = now()
         where id = $1::uuid`,
        [batchId, batch.title, batch.startsAt, batch.endsAt, batch.seatLimit, batch.timeZone, batch.status, batch.enrolmentOpen],
      )
      await audit(tx, actor.actorId, 'learning.batch_updated', staff.course.id, { batchId, status: batch.status })
    })
  }

  /** Sets (or clears, with null) the batch manager by a member's verified email. */
  async function setManager(actor: BatchActor, batchId: string, email: string | null) {
    return transaction(async (tx) => {
      const staff = await loadStaffBatch(tx, actor, batchId)
      if (!staff.canManageCourse) throw new BatchError('batch_not_found')
      const profileId = email ? await memberByVerifiedEmail(tx, email) : null
      if (email && !profileId) throw new BatchError('member_not_found')
      await tx(`update public.learning_course_batches set manager_profile_id = $2::uuid, updated_at = now() where id = $1::uuid`, [batchId, profileId])
      await audit(tx, actor.actorId, 'learning.batch_manager_set', staff.course.id, { batchId, cleared: !profileId })
    })
  }

  async function addInstructor(actor: BatchActor, batchId: string, email: string) {
    return transaction(async (tx) => {
      const staff = await loadStaffBatch(tx, actor, batchId)
      if (!staff.canManageCourse) throw new BatchError('batch_not_found')
      const profileId = await memberByVerifiedEmail(tx, email)
      if (!profileId) throw new BatchError('member_not_found')
      const rows = await tx(
        `insert into public.learning_batch_instructors (batch_id, profile_id, added_by)
         values ($1::uuid, $2::uuid, $3::uuid)
         on conflict (batch_id, profile_id) do nothing
         returning profile_id`,
        [batchId, profileId, actor.actorId],
      )
      await audit(tx, actor.actorId, 'learning.batch_instructor_added', staff.course.id, { batchId, added: rows.length })
      return rows.length > 0
    })
  }

  async function removeInstructor(actor: BatchActor, batchId: string, profileId: string) {
    return transaction(async (tx) => {
      const staff = await loadStaffBatch(tx, actor, batchId)
      if (!staff.canManageCourse) throw new BatchError('batch_not_found')
      await tx(`delete from public.learning_batch_instructors where batch_id = $1::uuid and profile_id = $2::uuid`, [batchId, profileId])
      await audit(tx, actor.actorId, 'learning.batch_instructor_removed', staff.course.id, { batchId })
    })
  }

  /**
   * Moves a learner's enrolment to another batch of the same course (course managers). The new batch must be open;
   * moving back into a batch they were already in is a no-op.
   */
  async function moveLearner(actor: BatchActor, input: { courseId: string; enrollmentId: string; toBatchId: string }) {
    return transaction(async (tx) => {
      const course = await loadManagedCourse(tx, actor, input.courseId)
      const enrollment = (await tx(
        `select id, batch_id from public.learning_enrollments where id = $1::uuid and course_id = $2::uuid for update`,
        [input.enrollmentId, course.id],
      ))[0]
      if (!enrollment) throw new BatchError('enrollment_not_found')
      if (enrollment.batch_id && String(enrollment.batch_id) === input.toBatchId) return false
      await lockBatchForEnrolment(tx, { courseId: course.id, batchId: input.toBatchId })
      await tx(`update public.learning_enrollments set batch_id = $2::uuid, updated_at = now() where id = $1::uuid`, [input.enrollmentId, input.toBatchId])
      await audit(tx, actor.actorId, 'learning.batch_learner_moved', course.id, {
        enrollmentId: input.enrollmentId,
        fromBatchId: enrollment.batch_id ? String(enrollment.batch_id) : null,
        toBatchId: input.toBatchId,
      })
      return true
    })
  }

  /** Batches this member runs as manager or instructor, across courses (Studio home "Batches you teach"). */
  async function listTeaching(profileId: string): Promise<TeachingBatch[]> {
    const rows = await query(
      `select ${BATCH_COLUMNS}, course.title as course_title,
              case when batch.manager_profile_id = $1::uuid then 'manager' else 'instructor' end as staff_role
       ${BATCH_FROM}
       inner join public.learning_courses course on course.id = batch.course_id
       where batch.status <> 'archived'
         and (batch.manager_profile_id = $1::uuid
              or exists (select 1 from public.learning_batch_instructors instructor
                         where instructor.batch_id = batch.id and instructor.profile_id = $1::uuid))
       order by batch.starts_at desc
       limit 50`,
      [profileId],
    )
    return rows.map((row) => ({
      batch: mapBatch(row),
      courseTitle: String(row.course_title),
      role: row.staff_role === 'manager' ? 'manager' : 'instructor',
    }))
  }

  /** Hourly: moves batches along (upcoming → running → completed). Updates batch rows only. */
  async function advanceStatuses(now: Date = new Date()) {
    const rows = await query(
      `select batch.id, batch.status, batch.starts_at, batch.ends_at,
              (select max(session.starts_at + make_interval(mins => session.duration_minutes))
                 from public.learning_batch_sessions session
                 where session.batch_id = batch.id and session.status = 'scheduled') as last_session_ends_at
       from public.learning_course_batches batch
       where batch.status in ('upcoming', 'running') and batch.starts_at <= $1::timestamptz
       order by batch.starts_at
       limit 500`,
      [now.toISOString()],
    )
    let moved = 0
    for (const row of rows) {
      const next = nextBatchStatus({
        status: asStatus(row.status),
        startsAt: iso(row.starts_at) ?? now.toISOString(),
        endsAt: iso(row.ends_at),
        lastSessionEndsAt: iso(row.last_session_ends_at),
      }, now)
      if (!next) continue
      const updated = await query(
        `update public.learning_course_batches set status = $2, updated_at = now()
         where id = $1::uuid and status = $3
         returning id`,
        [row.id, next, row.status],
      )
      moved += updated.length
    }
    return { checked: rows.length, moved }
  }

  return { courseMode, listForCourse, getForStaff, listForLearners, saveSettings, create, update, setManager, addInstructor, removeInstructor, moveLearner, listTeaching, advanceStatuses }
}

export const batchRepository = createBatchRepository()

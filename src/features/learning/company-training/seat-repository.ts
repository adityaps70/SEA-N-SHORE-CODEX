import { withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { BatchError, resolveEnrolmentBatch } from '../batches/batch-repository'
import { courseManagerAccessSql } from '../course-access'
import { notifyEnrolled } from '../learning-notifications'
import { loadTrainingCompany, type Query, type TrainingActor } from './company-access'
import { SEAT_REASSIGN_MAX_PROGRESS, SeatError, type SeatRefusal } from './seat-rules'

/**
 * Giving company seats to crew (round D, part 3). A seat goes to an active crew member (who accepted the company's
 * invitation) and enrols them in the course with the plan access the pack was bought with, counted from the day the
 * seat is assigned. An assigned seat cannot be refunded; it can move to another crew member while its learner is at
 * 10 % progress or less, which ends the first learner's access to it.
 */

type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

function clientQuery(client: DatabaseQueryClient): Query {
  return async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows
}

/** Whole-number progress of an enrolment: completed published lessons over all published lessons of its course. */
export function enrollmentProgressSql(enrollmentAlias: string) {
  return `(select case when count(*) = 0 then 0 else round(100.0 * count(*) filter (where exists (
              select 1 from public.learning_progress done
              where done.enrollment_id = ${enrollmentAlias}.id and done.lesson_id = progress_lesson.id and done.completed = true
            )) / count(*))::int end
     from public.learning_course_sections progress_section
     inner join public.learning_lessons progress_lesson
       on progress_lesson.section_id = progress_section.id and progress_lesson.is_published = true and progress_lesson.removed_at is null
     where progress_section.course_id = ${enrollmentAlias}.course_id and progress_section.removed_at is null)`
}

export type AssignOutcome = { profileId: string; ok: true; seatId: string; enrollmentId: string } | { profileId: string; ok: false; code: SeatRefusal }

async function audit(query: Query, actorId: string, action: string, companyId: string, metadata: Record<string, unknown>) {
  await query(
    `insert into public.audit_events (actor_id, action, target_type, target_id, metadata) values ($1::uuid, $2, 'company', $3, $4::jsonb)`,
    [actorId, action, companyId, JSON.stringify(metadata)],
  )
}

/** Why `profileId` cannot get a seat of this course (null when they can). */
async function learnerRefusal(query: Query, input: { companyId: string; courseId: string; profileId: string }): Promise<SeatRefusal | null> {
  const rows = await query(
    `select
       exists (select 1 from public.company_training_learners learner
               where learner.company_id = $1::uuid and learner.profile_id = $3::uuid and learner.status = 'active') as in_crew,
       ${courseManagerAccessSql('course', '$3::uuid')} as on_team,
       exists (select 1 from public.learning_enrollments enrollment
               where enrollment.course_id = course.id and enrollment.learner_id = $3::uuid and enrollment.status <> 'revoked'
                 and (enrollment.access_expires_at is null or enrollment.access_expires_at > now())) as enrolled
     from public.learning_courses course
     where course.id = $2::uuid`,
    [input.companyId, input.courseId, input.profileId],
  )
  const row = rows[0]
  if (!row) return 'seat_none_available'
  if (!row.in_crew) return 'seat_learner_not_in_crew'
  if (row.on_team) return 'seat_learner_is_course_team'
  if (row.enrolled) return 'seat_learner_already_enrolled'
  return null
}

/** Enrols the learner on the seat: the pack's plan access from now, joining the batch for a batch course. */
async function enrolOnSeat(query: Query, input: { seatId: string; companyId: string; courseId: string; profileId: string; actorId: string; batchId: string | null }) {
  const seat = (await query(
    `select seat.id, seat.times_assigned, o.plan_id, o.access_months
     from public.company_training_seats seat
     inner join public.course_payment_orders o on o.id = seat.order_id
     where seat.id = $1::uuid`,
    [input.seatId],
  ))[0]!
  let batchId: string | null = null
  try {
    const batch = await resolveEnrolmentBatch(query, { courseId: input.courseId, batchId: input.batchId })
    batchId = batch?.id ?? null
  } catch (error) {
    if (error instanceof BatchError && error.code === 'batch_required') throw new SeatError('seat_batch_required')
    throw error
  }
  const rows = await query(
    `insert into public.learning_enrollments (course_id, learner_id, enrollment_source, status, enrolled_at, enrolled_by, batch_id,
       plan_id, access_expires_at, company_seat_id, created_at, updated_at)
     values ($1::uuid, $2::uuid, 'trainer', 'active', now(), $3::uuid, $4::uuid, $5::uuid,
       case when $6::integer is null then null else now() + make_interval(months => $6::integer) end, $7::uuid, now(), now())
     on conflict (course_id, learner_id) do update
       set enrollment_source = 'trainer',
           status = case when learning_enrollments.completed_at is not null then 'completed' else 'active' end,
           revoked_at = null, payment_order_id = null, plan_id = excluded.plan_id, access_expires_at = excluded.access_expires_at,
           enrolled_by = excluded.enrolled_by, batch_id = coalesce(excluded.batch_id, learning_enrollments.batch_id),
           company_seat_id = excluded.company_seat_id,
           enrolled_at = case when learning_enrollments.status = 'revoked' then now() else learning_enrollments.enrolled_at end,
           updated_at = now()
       where learning_enrollments.status = 'revoked'
          or (learning_enrollments.access_expires_at is not null and learning_enrollments.access_expires_at <= now())
     returning id`,
    [input.courseId, input.profileId, input.actorId, batchId, seat.plan_id ?? null, seat.access_months ?? null, input.seatId],
  )
  if (!rows[0]) throw new SeatError('seat_learner_already_enrolled')
  const enrollmentId = String(rows[0].id)
  await query(
    `update public.company_training_seats
     set status = 'assigned', learner_id = $2::uuid, enrollment_id = $3::uuid, assigned_at = now(), assigned_by = $4::uuid,
         times_assigned = times_assigned + 1, updated_at = now()
     where id = $1::uuid`,
    [input.seatId, input.profileId, enrollmentId, input.actorId],
  )
  await notifyEnrolled(query, { learnerId: input.profileId, courseId: input.courseId, enrollmentId, occasion: `company-seat-${input.seatId}-${Number(seat.times_assigned) + 1}` }, { inTransaction: true })
  return enrollmentId
}

export function createSeatRepository(input: { transaction?: Transaction } = {}) {
  const transaction: Transaction = input.transaction ?? (<T>(work: (query: Query) => Promise<T>) => withTransaction((client) => work(clientQuery(client))))

  /**
   * Gives one seat of the course to each chosen crew member, oldest-expiring seat first. Each person gets their own
   * outcome; one refusal does not stop the others. A batch course needs the batch they join.
   */
  async function assign(actor: TrainingActor, companyId: string, request: { courseId: string; profileIds: string[]; batchId?: string | null }): Promise<AssignOutcome[]> {
    return transaction(async (tx) => {
      await loadTrainingCompany(tx, actor, companyId, { manage: true, lock: true })
      const outcomes: AssignOutcome[] = []
      for (const profileId of [...new Set(request.profileIds)].slice(0, 200)) {
        const refusal = await learnerRefusal(tx, { companyId, courseId: request.courseId, profileId })
        if (refusal) {
          outcomes.push({ profileId, ok: false, code: refusal })
          continue
        }
        const seat = (await tx(
          `select id from public.company_training_seats
           where company_id = $1::uuid and course_id = $2::uuid and status = 'available' and valid_until > now()
           order by valid_until asc, created_at asc, id asc
           limit 1
           for update skip locked`,
          [companyId, request.courseId],
        ))[0]
        if (!seat) {
          outcomes.push({ profileId, ok: false, code: 'seat_none_available' })
          continue
        }
        await tx('savepoint company_seat')
        try {
          const enrollmentId = await enrolOnSeat(tx, { seatId: String(seat.id), companyId, courseId: request.courseId, profileId, actorId: actor.actorId, batchId: request.batchId ?? null })
          await tx('release savepoint company_seat')
          outcomes.push({ profileId, ok: true, seatId: String(seat.id), enrollmentId })
        } catch (error) {
          await tx('rollback to savepoint company_seat')
          if (error instanceof SeatError) outcomes.push({ profileId, ok: false, code: error.code })
          else if (error instanceof BatchError) outcomes.push({ profileId, ok: false, code: 'seat_batch_required' })
          else throw error
        }
      }
      const assigned = outcomes.filter((outcome) => outcome.ok).length
      if (assigned) await audit(tx, actor.actorId, 'company_training.seats_assigned', companyId, { courseId: request.courseId, assigned, refused: outcomes.length - assigned })
      return outcomes
    })
  }

  /**
   * Moves an assigned seat to another crew member. Allowed while the current learner is at 10 % progress or less and
   * still shares with the company (or was taken off its crew); the current learner's access from the seat ends.
   */
  async function reassign(actor: TrainingActor, companyId: string, request: { seatId: string; toProfileId: string; batchId?: string | null }) {
    return transaction(async (tx) => {
      await loadTrainingCompany(tx, actor, companyId, { manage: true, lock: true })
      const rows = await tx(
        `select seat.id, seat.course_id, seat.learner_id, seat.enrollment_id, seat.status,
                learner.status as sharing,
                ${enrollmentProgressSql('enrollment')} as progress
         from public.company_training_seats seat
         left join public.learning_enrollments enrollment on enrollment.id = seat.enrollment_id
         left join public.company_training_learners learner on learner.company_id = seat.company_id and learner.profile_id = seat.learner_id
         where seat.id = $1::uuid and seat.company_id = $2::uuid
         for update of seat`,
        [request.seatId, companyId],
      )
      const seat = rows[0]
      if (!seat || seat.status !== 'assigned') throw new SeatError('seat_not_found')
      if (String(seat.learner_id) === request.toProfileId) throw new SeatError('seat_reassign_same_learner')
      if (seat.sharing === 'withdrawn') throw new SeatError('seat_reassign_sharing_stopped')
      if (seat.enrollment_id && Number(seat.progress ?? 0) > SEAT_REASSIGN_MAX_PROGRESS) throw new SeatError('seat_reassign_progress_too_high')
      const refusal = await learnerRefusal(tx, { companyId, courseId: String(seat.course_id), profileId: request.toProfileId })
      if (refusal) throw new SeatError(refusal)

      if (seat.enrollment_id) {
        await tx(
          `update public.learning_enrollments
           set status = 'revoked', revoked_at = now(), company_seat_id = null, updated_at = now()
           where id = $1::uuid and company_seat_id = $2::uuid`,
          [seat.enrollment_id, seat.id],
        )
      }
      await tx(
        `update public.company_training_seats set status = 'available', learner_id = null, enrollment_id = null, updated_at = now()
         where id = $1::uuid`,
        [seat.id],
      )
      const enrollmentId = await enrolOnSeat(tx, { seatId: String(seat.id), companyId, courseId: String(seat.course_id), profileId: request.toProfileId, actorId: actor.actorId, batchId: request.batchId ?? null })
      await audit(tx, actor.actorId, 'company_training.seat_reassigned', companyId, { courseId: String(seat.course_id), seatId: String(seat.id) })
      return { seatId: String(seat.id), enrollmentId }
    })
  }

  return { assign, reassign }
}

export const seatRepository = createSeatRepository()

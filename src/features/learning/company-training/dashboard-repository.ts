import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { loadTrainingCompany, type Query, type TrainingActor } from './company-access'
import { enrollmentProgressSql } from './seat-repository'
import { SEAT_REASSIGN_MAX_PROGRESS } from './seat-rules'

/**
 * The company training dashboard (round D, part 3). Everything here comes from the company's own seats: for each seat
 * in use, the course it is for and, while the learner shares with the company, their progress, completion and the
 * certificate of that enrolment. A learner who stopped sharing (or was taken off the crew) shows only that the seat is
 * used. Nothing about a member's other courses or activity is read.
 */

export type LearnerProgressState = 'not_started' | 'in_progress' | 'completed'

export type AssignedSeat = {
  seatId: string
  courseId: string
  courseTitle: string
  courseSlug: string | null
  assignedAt: string
  learner: { profileId: string; name: string; slug: string | null; vessel: string | null; rank: string | null }
  /** 'active' = shares progress; 'withdrawn' = stopped sharing; 'removed' = taken off the crew. */
  sharing: 'active' | 'withdrawn' | 'removed'
  progress: null | {
    percent: number
    state: LearnerProgressState
    completedAt: string | null
    accessExpiresAt: string | null
    certificate: { number: string; issuedAt: string; expiresAt: string | null } | null
  }
  /** Whether the seat can still move to someone else (learner at 10 % or less and still sharing or off the crew). */
  canReassign: boolean
}

export type GroupProgress = { label: string; assigned: number; notStarted: number; inProgress: number; completed: number }

export type TrainingDashboard = {
  totals: {
    seatsBought: number
    seatsAvailable: number
    seatsAssigned: number
    seatsExpired: number
    seatsRefunded: number
    crewActive: number
    crewStoppedSharing: number
    invitationsPending: number
    completed: number
    inProgress: number
    notStarted: number
    certificatesExpiringSoon: number
  }
  byVessel: GroupProgress[]
  byRank: GroupProgress[]
  seats: AssignedSeat[]
}

export const CERTIFICATE_EXPIRY_WINDOW_DAYS = 90

function iso(value: unknown) {
  if (value === null || value === undefined) return null
  return new Date(value instanceof Date ? value.getTime() : String(value)).toISOString()
}

function count(value: unknown) {
  return Number(value ?? 0)
}

const ASSIGNED_SEATS_SQL = `
  select seat.id as seat_id, seat.course_id, course.title as course_title, course.slug as course_slug, seat.assigned_at,
         seat.learner_id, profile.full_name, profile.slug as profile_slug,
         learner.vessel, learner.rank, coalesce(learner.status, 'removed') as sharing,
         case when learner.status = 'active' then enrollment.status end as enrollment_status,
         case when learner.status = 'active' then enrollment.completed_at end as completed_at,
         case when learner.status = 'active' then enrollment.access_expires_at end as access_expires_at,
         case when learner.status = 'active' then certificate.certificate_number end as certificate_number,
         case when learner.status = 'active' then certificate.issued_at end as certificate_issued_at,
         case when learner.status = 'active' then certificate.expires_at end as certificate_expires_at,
         ${enrollmentProgressSql('enrollment')} as progress
  from public.company_training_seats seat
  inner join public.learning_courses course on course.id = seat.course_id
  inner join public.profiles profile on profile.id = seat.learner_id
  left join public.learning_enrollments enrollment on enrollment.id = seat.enrollment_id
  left join public.learning_certificates certificate on certificate.enrollment_id = seat.enrollment_id
  left join public.company_training_learners learner on learner.company_id = seat.company_id and learner.profile_id = seat.learner_id
  where seat.company_id = $1::uuid and seat.status = 'assigned'
  order by seat.assigned_at desc, seat.id
  limit 5000`

function mapSeat(row: QueryResultRow): AssignedSeat {
  const sharing = row.sharing === 'active' || row.sharing === 'withdrawn' ? row.sharing : 'removed'
  const percent = Math.max(0, Math.min(100, count(row.progress)))
  const completed = sharing === 'active' && (row.enrollment_status === 'completed' || row.completed_at)
  return {
    seatId: String(row.seat_id),
    courseId: String(row.course_id),
    courseTitle: String(row.course_title ?? ''),
    courseSlug: row.course_slug ? String(row.course_slug) : null,
    assignedAt: iso(row.assigned_at) ?? new Date(0).toISOString(),
    learner: {
      profileId: String(row.learner_id),
      name: String(row.full_name ?? '').trim() || 'Sea N Shore member',
      slug: row.profile_slug ? String(row.profile_slug) : null,
      vessel: sharing === 'removed' ? null : row.vessel ? String(row.vessel) : null,
      rank: sharing === 'removed' ? null : row.rank ? String(row.rank) : null,
    },
    sharing,
    progress: sharing === 'active'
      ? {
          percent: completed ? 100 : percent,
          state: completed ? 'completed' : percent > 0 ? 'in_progress' : 'not_started',
          completedAt: iso(row.completed_at),
          accessExpiresAt: iso(row.access_expires_at),
          certificate: row.certificate_number
            ? { number: String(row.certificate_number), issuedAt: iso(row.certificate_issued_at)!, expiresAt: iso(row.certificate_expires_at) }
            : null,
        }
      : null,
    canReassign: sharing !== 'withdrawn' && !completed && percent <= SEAT_REASSIGN_MAX_PROGRESS,
  }
}

function groupBy(seats: AssignedSeat[], pick: (seat: AssignedSeat) => string | null, unset: string): GroupProgress[] {
  const groups = new Map<string, GroupProgress>()
  for (const seat of seats) {
    if (!seat.progress) continue
    const label = pick(seat) ?? unset
    const group = groups.get(label) ?? { label, assigned: 0, notStarted: 0, inProgress: 0, completed: 0 }
    group.assigned += 1
    if (seat.progress.state === 'completed') group.completed += 1
    else if (seat.progress.state === 'in_progress') group.inProgress += 1
    else group.notStarted += 1
    groups.set(label, group)
  }
  return [...groups.values()].sort((a, b) => (a.label === unset ? 1 : b.label === unset ? -1 : a.label.localeCompare(b.label)))
}

const CSV_HEADER = ['Name', 'Vessel', 'Rank', 'Course', 'Assigned on', 'Sharing', 'Progress %', 'Status', 'Completed on', 'Certificate number', 'Certificate issued', 'Certificate expires', 'Access until']

function csvCell(value: string | number | null) {
  if (value === null) return ''
  const text = String(value)
  // Spreadsheet formulas never run from an export.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

function day(value: string | null) {
  return value ? value.slice(0, 10) : null
}

export function trainingCsv(seats: AssignedSeat[]) {
  const status = (seat: AssignedSeat) => (seat.progress ? { completed: 'Completed', in_progress: 'In progress', not_started: 'Not started' }[seat.progress.state] : null)
  const lines = [CSV_HEADER.join(',')]
  for (const seat of seats) {
    lines.push([
      seat.learner.name, seat.learner.vessel, seat.learner.rank, seat.courseTitle, day(seat.assignedAt),
      seat.sharing === 'active' ? 'Yes' : seat.sharing === 'withdrawn' ? 'Stopped sharing' : 'Left the crew',
      seat.progress?.percent ?? null, status(seat), day(seat.progress?.completedAt ?? null),
      seat.progress?.certificate?.number ?? null, day(seat.progress?.certificate?.issuedAt ?? null), day(seat.progress?.certificate?.expiresAt ?? null),
      day(seat.progress?.accessExpiresAt ?? null),
    ].map(csvCell).join(','))
  }
  return `${lines.join('\r\n')}\r\n`
}

type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

export function createTrainingDashboardRepository(input: { query?: Query; transaction?: Transaction } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction: Transaction = input.transaction ?? (<T>(work: (query: Query) => Promise<T>) => withTransaction((client: DatabaseQueryClient) => work(async (text, values) => (await client.query(text, values ? [...values] : undefined)).rows)))

  async function dashboard(actor: TrainingActor, companyId: string, now = new Date()): Promise<TrainingDashboard> {
    await loadTrainingCompany(query, actor, companyId)
    const [rows, seatTotals, crew] = await Promise.all([
      query(ASSIGNED_SEATS_SQL, [companyId]),
      query(
        `select count(*) filter (where status <> 'refunded' and status <> 'refund_pending') as bought,
                count(*) filter (where status = 'available' and valid_until > $2::timestamptz) as available,
                count(*) filter (where status = 'assigned') as assigned,
                count(*) filter (where status = 'available' and valid_until <= $2::timestamptz) as expired,
                count(*) filter (where status = 'refunded') as refunded
         from public.company_training_seats where company_id = $1::uuid`,
        [companyId, now.toISOString()],
      ),
      query(
        `select count(*) filter (where status = 'active') as active,
                count(*) filter (where status = 'withdrawn') as withdrawn,
                (select count(*) from public.company_training_invitations invitation
                  where invitation.company_id = $1::uuid and invitation.status = 'pending' and invitation.expires_at > now()) as pending
         from public.company_training_learners where company_id = $1::uuid`,
        [companyId],
      ),
    ])
    const seats = rows.map(mapSeat)
    const soon = now.getTime() + CERTIFICATE_EXPIRY_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const shared = seats.filter((seat) => seat.progress)
    return {
      totals: {
        seatsBought: count(seatTotals[0]?.bought),
        seatsAvailable: count(seatTotals[0]?.available),
        seatsAssigned: count(seatTotals[0]?.assigned),
        seatsExpired: count(seatTotals[0]?.expired),
        seatsRefunded: count(seatTotals[0]?.refunded),
        crewActive: count(crew[0]?.active),
        crewStoppedSharing: count(crew[0]?.withdrawn),
        invitationsPending: count(crew[0]?.pending),
        completed: shared.filter((seat) => seat.progress!.state === 'completed').length,
        inProgress: shared.filter((seat) => seat.progress!.state === 'in_progress').length,
        notStarted: shared.filter((seat) => seat.progress!.state === 'not_started').length,
        certificatesExpiringSoon: shared.filter((seat) => {
          const expires = seat.progress!.certificate?.expiresAt
          return expires ? Date.parse(expires) > now.getTime() && Date.parse(expires) <= soon : false
        }).length,
      },
      byVessel: groupBy(seats, (seat) => seat.learner.vessel, 'No vessel set'),
      byRank: groupBy(seats, (seat) => seat.learner.rank, 'No rank set'),
      seats,
    }
  }

  /** The dashboard rows as CSV, audited with who exported and how many rows (never the rows themselves). */
  async function exportCsv(actor: TrainingActor, companyId: string) {
    return transaction(async (tx) => {
      await loadTrainingCompany(tx, actor, companyId)
      const seats = (await tx(ASSIGNED_SEATS_SQL, [companyId])).map(mapSeat)
      await tx(
        `insert into public.audit_events (actor_id, action, target_type, target_id, metadata) values ($1::uuid, 'company_training.exported', 'company', $2, $3::jsonb)`,
        [actor.actorId, companyId, JSON.stringify({ rows: seats.length, platformAdmin: Boolean(actor.platformAdmin) })],
      )
      return trainingCsv(seats)
    })
  }

  return { dashboard, exportCsv }
}

export const trainingDashboardRepository = createTrainingDashboardRepository()

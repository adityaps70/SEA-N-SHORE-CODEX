import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { planVisibleSql } from '@/features/billing/plan-visibility'
import { LIVE_JOB_SQL } from '@/features/jobs/repository'

/**
 * What the final legacy reminder says is on Sea N Shore right now, counted from the database when the email is built
 * (each send, the admin preview and a test). A count that is 0 or could not be read is null: the email then names
 * the item without a number, so it never shows an invented or stale figure.
 */
export type LegacyLiveCounts = {
  /** Live jobs members can find and apply to (the jobs list and the admin overview count the same, LIVE_JOB_SQL). */
  openJobs: number | null
  /** Published courses listed in the marketplace (same rules as the course list). */
  courses: number | null
  /** Published events that have not ended (the events page lists the same). */
  upcomingEvents: number | null
}

export const NO_LIVE_COUNTS: LegacyLiveCounts = { openJobs: null, courses: null, upcomingEvents: null }

type Query = <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) => Promise<T[]>

export const LIVE_COUNT_SQL = {
  openJobs: `select count(*) as count from public.jobs j where ${LIVE_JOB_SQL}`,
  // The marketplace's visibility rule (features/learning/marketplace-repository.ts), counted.
  courses: `
    select count(*) as count
    from public.learning_courses course
    left join public.learning_mentors mentor on mentor.id = course.mentor_id
    left join public.learning_mentor_applications application
      on application.user_id = mentor.user_id and application.status = 'approved'
    left join public.companies company on company.id = course.company_id
    where course.status = 'published'
      and (
        (course.company_id is null and mentor.status = 'active' and application.status = 'approved')
        or (course.company_id is not null and company.is_verified = true)
      )
      and course.removed_at is null
      and ${planVisibleSql('course', 'course')}`,
  upcomingEvents: `
    select count(*) as count
    from public.events e
    where e.status = 'published'
      and e.removed_at is null
      and ${planVisibleSql('event', 'e')}
      and e.end_at > now()`,
} as const

/** A positive whole count, or null (0, unreadable or not a number). */
export function liveCount(value: unknown): number | null {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 1 ? Math.floor(parsed) : null
}

export function createLegacyLiveCounts(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))

  async function one(sql: string) {
    try {
      const rows = await queryRows<{ count: string | number }>(sql)
      return liveCount(rows[0]?.count)
    } catch {
      return null
    }
  }

  return {
    /** Each count on its own: one that fails leaves the others. Never throws. */
    async read(): Promise<LegacyLiveCounts> {
      const [openJobs, courses, upcomingEvents] = await Promise.all([
        one(LIVE_COUNT_SQL.openJobs),
        one(LIVE_COUNT_SQL.courses),
        one(LIVE_COUNT_SQL.upcomingEvents),
      ])
      return { openJobs, courses, upcomingEvents }
    },
  }
}

export const legacyLiveCounts = createLegacyLiveCounts()

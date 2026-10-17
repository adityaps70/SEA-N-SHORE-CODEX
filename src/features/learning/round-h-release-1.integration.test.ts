import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase, type TestQuery } from '@/lib/db/test-database'
import { certificateSelfIssuedSql, issueCertificateForCompletedEnrollmentWithQuery } from './certificate-repository'
import * as fixtures from './learning-test-fixtures'

/**
 * Round H release 1 (migration 0087): self-issued certificates, the test course clean-up and the cancelled internal
 * event. The migration runs once while the test database is built; here its statements run again on the real
 * schema (PGlite) with placeholder data only.
 */
const MIGRATION = readFileSync(join(process.cwd(), 'infra/aws/database/migrations/0087_site_fixes_round_h_release_1.sql'), 'utf8')
  .split('-- statement-breakpoint')
  .filter((statement) => statement.split('\n').some((line) => line.trim() && !line.trim().startsWith('--')))

let db: TestDatabase
let ownCertificateId: string
let teamCertificateId: string
let learnerCertificateId: string
let testCourseId: string
let testCourseCertificateId: string
let internalEventId: string
let liveEventId: string

async function runMigration(query: TestQuery = db.query) {
  for (const statement of MIGRATION) await query(statement)
}

async function certificateFor(courseId: string, learnerId: string, title: string) {
  const [enrollment] = await db.query(
    `insert into public.learning_enrollments (course_id, learner_id, status, completed_at) values ($1, $2, 'completed', now()) returning id`,
    [courseId, learnerId],
  )
  const [certificate] = await db.query(
    `insert into public.learning_certificates (enrollment_id, course_id, learner_id, learner_name, course_title, mentor_name, completed_at)
     values ($1, $2, $3, 'Placeholder Holder', $4, 'Placeholder Publisher', now()) returning id`,
    [enrollment!.id, courseId, learnerId, title],
  )
  return String(certificate!.id)
}

async function event(host: string, title: string, status: string) {
  const [row] = await db.query(
    `insert into public.events (host_user_id, title, summary, description, format, meeting_url, status, start_at, end_at, timezone)
     values ($1, $2, 'Placeholder summary', '', 'online', 'https://example.com/meet', $3, now() - interval '2 days', now() - interval '2 days' + interval '1 hour', 'UTC') returning id`,
    [host, title, status],
  )
  return String(row!.id)
}

beforeAll(async () => {
  db = await createTestDatabase()
  const trainer = await fixtures.createActiveMentor(db.query)
  const course = await fixtures.createPublishedCourse(db.query, trainer, { certificateEnabled: true })
  // The trainer took their own course.
  ownCertificateId = await certificateFor(course.courseId, trainer.userId, 'Fixture SIRE Readiness')
  const learner = await fixtures.createProfile(db.query, 'Placeholder Learner')
  learnerCertificateId = await certificateFor(course.courseId, learner, 'Fixture SIRE Readiness')

  // An organization course taken by a member of its team.
  const owner = await fixtures.createProfile(db.query, 'Placeholder Org Owner')
  const teamMember = await fixtures.createProfile(db.query, 'Placeholder Team Member')
  const [company] = await db.query(`insert into public.companies (slug, name, created_by, is_verified) values ('placeholder-org', 'Placeholder Org', $1, true) returning id`, [owner])
  await db.query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, 'owner', now()), ($1, $3, 'member', now())`, [company!.id, owner, teamMember])
  const [orgCourse] = await db.query(
    `insert into public.learning_courses (company_id, created_by_user_id, slug, title, description, category, level, access_type, price_minor, currency, certificate_enabled, status, published_at, approved_at)
     values ($1, $2, 'placeholder-org-course', 'Placeholder Org Course', 'A placeholder organization course for the round H test.', 'Vetting & Inspections', 'beginner', 'free', 0, 'INR', true, 'published', now(), now()) returning id`,
    [company!.id, owner],
  )
  teamCertificateId = await certificateFor(String(orgCourse!.id), teamMember, 'Placeholder Org Course')

  // The keyboard-mash test course and its certificate.
  const [testCourse] = await db.query(
    `insert into public.learning_courses (mentor_id, created_by_user_id, slug, title, description, category, level, access_type, price_minor, currency, certificate_enabled, status, published_at, approved_at)
     values ($1, $2, 'iktyujdhrgsefawd', 'iktyujdhrgsefawd', 'A placeholder test course used by the round H clean-up test.', 'Vetting & Inspections', 'beginner', 'free', 0, 'INR', true, 'published', now(), now()) returning id`,
    [trainer.mentorId, trainer.userId],
  )
  testCourseId = String(testCourse!.id)
  testCourseCertificateId = await certificateFor(testCourseId, trainer.userId, 'iktyujdhrgsefawd')

  internalEventId = await event(owner, 'Sea N shore portal — discussion and brainstorming as how to market', 'cancelled')
  liveEventId = await event(owner, 'Placeholder Bridge Resource Management talk', 'published')
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function certificate(id: string) {
  const [row] = await db.query(`select issuer_relation, hidden_from_profile from public.learning_certificates where id = $1`, [id])
  return row
}

describe('migration 0087 (round H release 1)', () => {
  it("adds the certificate and privacy columns with today's rules as defaults", async () => {
    const columns = await db.query(
      `select column_name, column_default from information_schema.columns
       where table_schema = 'public' and table_name = 'member_preferences' and column_name in ('message_permission', 'connections_visibility')
       order by column_name`,
    )
    expect(columns.map((row) => [row.column_name, String(row.column_default)])).toEqual([
      ['connections_visibility', "'connections'::text"],
      ['message_permission', "'connections'::text"],
    ])
    await expect(db.query(`update public.learning_certificates set issuer_relation = 'verified' where id = $1`, [learnerCertificateId])).rejects.toThrow()
  })

  it("marks certificates of the course's own mentor and of the organization's team self-issued, and only those", async () => {
    await runMigration()
    expect(await certificate(ownCertificateId)).toMatchObject({ issuer_relation: 'self_issued' })
    expect(await certificate(teamCertificateId)).toMatchObject({ issuer_relation: 'self_issued' })
    expect(await certificate(learnerCertificateId)).toMatchObject({ issuer_relation: 'independent', hidden_from_profile: false })
  })

  it('archives and removes the test course and hides its certificate, keeping every row', async () => {
    const [course] = await db.query(`select status, removed_at from public.learning_courses where id = $1`, [testCourseId])
    expect(course).toMatchObject({ status: 'archived' })
    expect(course!.removed_at).not.toBeNull()
    expect(await certificate(testCourseCertificateId)).toMatchObject({ hidden_from_profile: true, issuer_relation: 'self_issued' })
  })

  it('removes the cancelled internal event from public lists and leaves other events alone', async () => {
    const rows = await db.query(`select id, removed_at from public.events where id in ($1, $2)`, [internalEventId, liveEventId])
    expect(rows.find((row) => row.id === internalEventId)!.removed_at).not.toBeNull()
    expect(rows.find((row) => row.id === liveEventId)!.removed_at).toBeNull()
  })

  it('keeps the previous values in one audit row, and a second run changes nothing', async () => {
    const audits = await db.query(`select metadata from public.audit_events where action = 'site_fixes.round_h.release_1'`)
    // The build ran the migration once with no data (no row); the run above wrote one.
    expect(audits).toHaveLength(1)
    const metadata = audits[0]!.metadata as Record<string, Array<Record<string, unknown>>>
    expect(metadata.self_issued_certificates!.map((row) => row.id).sort()).toEqual([ownCertificateId, teamCertificateId, testCourseCertificateId].sort())
    expect(metadata.test_courses).toEqual([{ id: testCourseId, status: 'published', removed_at: null }])
    expect(metadata.internal_events).toEqual([{ id: internalEventId, removed_at: null }])

    const before = await db.query(`select id, updated_at from public.learning_courses where id = $1`, [testCourseId])
    await runMigration()
    expect(await db.query(`select metadata from public.audit_events where action = 'site_fixes.round_h.release_1'`)).toHaveLength(1)
    expect(await db.query(`select id, updated_at from public.learning_courses where id = $1`, [testCourseId])).toEqual(before)
  })

  it('refuses before changing anything when two live courses carry the test title', async () => {
    let message = ''
    await db.transaction(async (query) => {
      const trainer = await fixtures.createActiveMentor(query)
      for (const slug of ['iktyujdhrgsefawd-a', 'iktyujdhrgsefawd-b']) {
        await query(
          `insert into public.learning_courses (mentor_id, created_by_user_id, slug, title, description, category, level, access_type, price_minor, currency, status)
           values ($1, $2, $3, 'iktyujdhrgsefawd', 'A placeholder duplicate for the refusal test.', 'Vetting & Inspections', 'beginner', 'free', 0, 'INR', 'draft')`,
          [trainer.mentorId, trainer.userId, slug],
        )
      }
      try {
        await runMigration(query)
      } catch (error) {
        message = error instanceof Error ? error.message : String(error)
      }
      throw new Error('rollback')
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== 'rollback') throw error
    })
    expect(message).toContain('more than one live course is titled iktyujdhrgsefawd')
  })

  it('uses the same rule as new certificates', () => {
    expect(certificateSelfIssuedSql()).toContain('own_mentor.user_id = enrollment.learner_id')
    expect(certificateSelfIssuedSql()).toContain('own_team.approved_at is not null')
  })

  it('issues a new certificate to the course\'s own mentor as self-issued, and to other learners as verified', async () => {
    const trainer = await fixtures.createActiveMentor(db.query)
    const course = await fixtures.createPublishedCourse(db.query, trainer, { certificateEnabled: true })
    const outsider = await fixtures.createProfile(db.query, 'Placeholder Outside Learner')
    const issued: Record<string, string | undefined> = {}
    for (const [label, learnerId] of [['mentor', trainer.userId], ['outsider', outsider]] as const) {
      const [enrollment] = await db.query(
        `insert into public.learning_enrollments (course_id, learner_id, status, completed_at) values ($1, $2, 'completed', now()) returning id`,
        [course.courseId, learnerId],
      )
      const certificate = await issueCertificateForCompletedEnrollmentWithQuery(db.query, String(enrollment!.id))
      issued[label] = certificate?.issuerRelation
    }
    expect(issued).toEqual({ mentor: 'self_issued', outsider: 'independent' })
  })
})


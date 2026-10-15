import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase, type TestQuery } from '@/lib/db/test-database'
import { planVisibleSql } from '@/features/billing/plan-visibility'
import { courseManagerAccessSql } from './course-access'
import { coursePublisherNameSql, publishedCourseVisibilitySql } from './course-publication'
import * as fixtures from './learning-test-fixtures'

/**
 * Data fix T1 (migration 0086): the SIRE course and its draft copy move from the trainer's personal profile to the
 * organization. Runs the real migration statements on the real schema (PGlite) with placeholder data only.
 */
const LIVE = 'f046e907-b42d-4a19-a47e-4e435ad582d2'
const DRAFT = '23c5171e-adde-4515-b90a-77ac94e635c5'
const ORG = '8283e58e-8fd6-4d3a-9271-a7e7abb3549f'
const ORG_SLUG = 'beaufort-marine-services-llp-eddf5d86'

const MIGRATION = readFileSync(join(process.cwd(), 'infra/aws/database/migrations/0086_sire_course_transfer.sql'), 'utf8')
  .split('-- statement-breakpoint')
  .filter((statement) => statement.split('\n').some((line) => line.trim() && !line.trim().startsWith('--')))

let db: TestDatabase
let trainer: { userId: string; mentorId: string }
let learnerId: string
let enrollmentId: string
let orderId: string

async function runMigration(query: TestQuery = db.query) {
  for (const statement of MIGRATION) await query(statement)
}

/** Runs the migration after a change, inside a transaction that is always rolled back. */
async function refusalWith(change: string, values: readonly unknown[] = []) {
  let message = ''
  await db.transaction(async (query) => {
    await query(change, values)
    try {
      await runMigration(query)
    } catch (error) {
      message = error instanceof Error ? error.message : String(error)
    }
    throw new Error('rollback')
  }).catch((error: unknown) => {
    if (!(error instanceof Error) || error.message !== 'rollback') throw error
  })
  return message
}

async function publisherRows() {
  return db.query(
    `select id, mentor_id, company_id, created_by_user_id from public.learning_courses
     where id = $1 or revision_of_course_id = $1 order by created_at, id`,
    [LIVE],
  )
}

async function counts() {
  const [row] = await db.query(
    `select
       (select count(*)::int from public.learning_enrollments where course_id = $1) as enrolments,
       (select count(*)::int from public.learning_progress where enrollment_id = $2) as progress,
       (select count(*)::int from public.learning_certificates where course_id = $1) as certificates,
       (select count(*)::int from public.course_payment_orders where course_id = $1 and status = 'paid') as paid_orders,
       (select count(*)::int from public.seller_earnings where source_id = $3 and seller_profile_id = $4) as trainer_earnings`,
    [LIVE, enrollmentId, orderId, trainer.userId],
  )
  return row
}

beforeAll(async () => {
  db = await createTestDatabase()
  trainer = await fixtures.createActiveMentor(db.query)
  const otherAdmin = await fixtures.createProfile(db.query, 'Placeholder Org Owner')
  await db.query(
    `insert into public.companies (id, slug, name, created_by, is_verified) values ($1, $2, 'Placeholder Marine Org', $3, true)`,
    [ORG, ORG_SLUG, otherAdmin],
  )
  await db.query(
    `insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, 'owner', now()), ($1, $3, 'administrator', now())`,
    [ORG, otherAdmin, trainer.userId],
  )
  await db.query(
    `insert into public.account_subscriptions (company_id, plan_code, status, current_period_ends_at)
     values ($1, 'organization_pro', 'active', now() + interval '30 days')`,
    [ORG],
  )
  await db.query(
    `insert into public.learning_courses (
       id, mentor_id, created_by_user_id, slug, title, description, category, level, access_type, price_minor,
       currency, certificate_enabled, status, published_at, approved_at
     ) values ($1, $2, $3, 'placeholder-sire-course', 'Placeholder SIRE course', 'A placeholder course used only by the T1 transfer test.',
       'Vetting & Inspections', 'intermediate', 'paid', 99900, 'INR', true, 'published', now(), now())`,
    [LIVE, trainer.mentorId, trainer.userId],
  )
  await db.query(
    `insert into public.learning_courses (
       id, mentor_id, created_by_user_id, slug, title, description, category, level, access_type, price_minor,
       currency, certificate_enabled, status, revision_of_course_id
     ) values ($1, $2, $3, 'placeholder-sire-course-draft', 'Placeholder SIRE course', 'A placeholder draft copy used only by the T1 transfer test.',
       'Vetting & Inspections', 'intermediate', 'paid', 99900, 'INR', true, 'draft', $4)`,
    [DRAFT, trainer.mentorId, trainer.userId, LIVE],
  )
  await db.query(
    `insert into public.learning_promo_codes (mentor_id, course_id, code, discount_type, percent_off, created_by)
     values ($1, $2, 'SIRE10', 'percent', 10, $3)`,
    [trainer.mentorId, LIVE, trainer.userId],
  )

  learnerId = await fixtures.createProfile(db.query, 'Placeholder Learner')
  const [enrollment] = await db.query(
    `insert into public.learning_enrollments (course_id, learner_id, status, completed_at) values ($1, $2, 'completed', now()) returning id`,
    [LIVE, learnerId],
  )
  enrollmentId = String(enrollment!.id)
  const [section] = await db.query(`insert into public.learning_course_sections (course_id, title, position) values ($1, 'Section A', 0) returning id`, [LIVE])
  const [lesson] = await db.query(
    `insert into public.learning_lessons (section_id, position, title, lesson_type, completion_rule) values ($1, 0, 'Intro', 'article', 'manual') returning id`,
    [section!.id],
  )
  await db.query(`insert into public.learning_progress (enrollment_id, lesson_id, completed, completed_at) values ($1, $2, true, now())`, [enrollmentId, lesson!.id])
  await db.query(
    `insert into public.learning_certificates (enrollment_id, course_id, learner_id, learner_name, course_title, mentor_name, completed_at)
     values ($1, $2, $3, 'Placeholder Learner', 'Placeholder SIRE course', 'Placeholder Trainer', now())`,
    [enrollmentId, LIVE, learnerId],
  )
  const [order] = await db.query(
    `insert into public.course_payment_orders (course_id, profile_id, course_title, list_price_minor, amount_minor, currency, provider, provider_order_id, status, paid_at)
     values ($1, $2, 'Placeholder SIRE course', 99900, 99900, 'INR', 'cashfree', 'placeholder-order-1', 'paid', now()) returning id`,
    [LIVE, learnerId],
  )
  orderId = String(order!.id)
  await db.query(
    `insert into public.seller_earnings (seller_profile_id, source_type, source_id, currency, gross_minor, platform_fee_percent, platform_fee_minor, net_minor, available_at)
     values ($1, 'course_purchase', $2, 'INR', 99900, 10, 9990, 89910, now() + interval '7 days')`,
    [trainer.userId, orderId],
  )
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('T1: SIRE course transfer to the organization (migration 0086)', () => {
  it('refuses, changing nothing, when the organization or the trainer’s role is not right', async () => {
    const before = await publisherRows()

    expect(await refusalWith(`update public.companies set is_verified = false where id = $1`, [ORG])).toMatch(/not a claimed, verified page/)
    expect(await refusalWith(`update public.companies set slug = 'another-placeholder-org' where id = $1`, [ORG])).toMatch(/slug do not match/)
    expect(await refusalWith(`update public.account_subscriptions set status = 'expired' where company_id = $1`, [ORG])).toMatch(/may not publish courses/)
    expect(await refusalWith(`update public.company_members set role = 'recruiter' where company_id = $1 and user_id = $2`, [ORG, trainer.userId]))
      .toMatch(/not an owner, administrator or LMS manager/)
    expect(await refusalWith(
      `insert into public.learning_promo_codes (company_id, code, discount_type, percent_off) values ($1, 'SIRE10', 'percent', 5)`,
      [ORG],
    )).toMatch(/same code/)

    expect(await publisherRows()).toEqual(before)
    expect(await db.query(`select 1 from public.audit_events where action = 'learning.course.publisher_transferred'`)).toHaveLength(0)
  })

  it('moves the course and its draft copy to the organization, keeping learners, sales and certificates', async () => {
    const before = await counts()
    const [certificateBefore] = await db.query(`select * from public.learning_certificates where course_id = $1`, [LIVE])

    await runMigration()

    expect(await publisherRows()).toEqual([
      { id: LIVE, mentor_id: null, company_id: ORG, created_by_user_id: trainer.userId },
      { id: DRAFT, mentor_id: null, company_id: ORG, created_by_user_id: trainer.userId },
    ])
    expect(await counts()).toEqual(before)
    expect(before).toEqual({ enrolments: 1, progress: 1, certificates: 1, paid_orders: 1, trainer_earnings: 1 })
    expect(await db.query(`select * from public.learning_certificates where course_id = $1`, [LIVE])).toEqual([certificateBefore])
    expect(await db.query(`select mentor_id, company_id from public.learning_promo_codes where course_id = $1`, [LIVE]))
      .toEqual([{ mentor_id: null, company_id: ORG }])

    const [audit] = await db.query(`select actor_id, target_type, target_id, metadata from public.audit_events where action = 'learning.course.publisher_transferred'`)
    expect(audit).toMatchObject({ actor_id: null, target_type: 'learning_course', target_id: LIVE })
    expect(audit!.metadata).toMatchObject({
      to_company_id: ORG,
      courses: [
        { id: LIVE, mentor_id: trainer.mentorId, company_id: null },
        { id: DRAFT, mentor_id: trainer.mentorId, company_id: null },
      ],
      promo_codes: [{ mentor_id: trainer.mentorId, company_id: null }],
    })

    // The trainer keeps editing both rows as an administrator of the organization.
    const access = await db.query(
      `select course.id, ${courseManagerAccessSql('course', '$2')} as can_manage from public.learning_courses course
       where course.id = any($1::uuid[]) order by course.created_at, course.id`,
      [[LIVE, DRAFT], trainer.userId],
    )
    expect(access).toEqual([{ id: LIVE, can_manage: true }, { id: DRAFT, can_manage: true }])

    // Published under the organization, visible to learners, and listed under it in search.
    const [publicView] = await db.query(
      `select ${coursePublisherNameSql()} as publisher, (${publishedCourseVisibilitySql()}) as visible, ${planVisibleSql('course', 'course')} as plan_visible
       from public.learning_courses course
       left join public.learning_mentors mentor on mentor.id = course.mentor_id
       left join public.learning_mentor_applications application on application.id = mentor.application_id
       left join public.companies company on company.id = course.company_id
       where course.id = $1`,
      [LIVE],
    )
    expect(publicView).toEqual({ publisher: 'Placeholder Marine Org', visible: true, plan_visible: true })
    expect(await db.query(`select org_id from public.search_documents where kind = 'course' and entity_id = $1`, [LIVE])).toEqual([{ org_id: ORG }])
  })

  it('does nothing when run a second time', async () => {
    const rows = await db.query(`select id, updated_at from public.learning_courses where id = $1 or revision_of_course_id = $1 order by id`, [LIVE])

    await runMigration()

    expect(await db.query(`select id, updated_at from public.learning_courses where id = $1 or revision_of_course_id = $1 order by id`, [LIVE])).toEqual(rows)
    expect(await db.query(`select 1 from public.audit_events where action = 'learning.course.publisher_transferred'`)).toHaveLength(1)
  })

  it('can be reversed from the audit row', async () => {
    await db.transaction(async (query) => {
      const [audit] = await query(`select metadata from public.audit_events where action = 'learning.course.publisher_transferred' and target_id = $1`, [LIVE])
      await query(REVERSE_COURSES, [audit!.metadata])
      await query(REVERSE_PROMO_CODES, [audit!.metadata])
      const rows = await query(`select id, mentor_id, company_id from public.learning_courses where id = $1 or revision_of_course_id = $1 order by created_at, id`, [LIVE])
      expect(rows).toEqual([
        { id: LIVE, mentor_id: trainer.mentorId, company_id: null },
        { id: DRAFT, mentor_id: trainer.mentorId, company_id: null },
      ])
      expect(await query(`select mentor_id, company_id from public.learning_promo_codes where course_id = $1`, [LIVE]))
        .toEqual([{ mentor_id: trainer.mentorId, company_id: null }])
      throw new Error('rollback')
    }).catch((error: unknown) => {
      if (!(error instanceof Error) || error.message !== 'rollback') throw error
    })
  })
})

/** The reversal written up in the T1 report: restores the saved publisher of each row from the audit metadata ($1). */
const REVERSE_COURSES = `update public.learning_courses c
  set mentor_id = (saved->>'mentor_id')::uuid, company_id = (saved->>'company_id')::uuid, updated_at = now()
  from jsonb_array_elements($1::jsonb->'courses') saved
  where c.id = (saved->>'id')::uuid`
const REVERSE_PROMO_CODES = `update public.learning_promo_codes p
  set mentor_id = (saved->>'mentor_id')::uuid, company_id = (saved->>'company_id')::uuid, updated_at = now()
  from jsonb_array_elements($1::jsonb->'promo_codes') saved
  where p.id = (saved->>'id')::uuid`

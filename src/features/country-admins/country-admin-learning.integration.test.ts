import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createLearningAdminRepository } from '@/features/learning/admin-repository'
import { createCourseRatingRepository } from '@/features/learning/course-rating-repository'
import { createActiveMentor } from '@/features/learning/learning-test-fixtures'
import { createCountryAdminRepository } from './repository'

/**
 * Round GP Part E (E3), against the real schema (PGlite, every migration): a Philippines country admin with Learning
 * sees and decides only their countries' trainer applications, courses, ratings and owner replies; a course belongs
 * to its organization's country, or else its trainer's country of residence. "Act" is needed to decide; every
 * decision is audited with the section and the country; platform administrators keep every power. Placeholder data.
 */
let db: TestDatabase
type Row = Record<string, unknown>
const run = (text: string, values?: readonly unknown[]) => db.query(text, values ? [...values] : undefined) as Promise<Row[]>
const transaction = async <T,>(work: (query: typeof run) => Promise<T>) => db.transaction((query) => work(query as typeof run))
let sequence = 0

let platformAdmin = ''
let partner = ''

async function profile(name: string, residence: string | null) {
  sequence += 1
  return String((await run(
    `insert into public.profiles (id, full_name, slug, profile_type, headline, summary, onboarding_completed_at, country_of_residence)
     values (gen_random_uuid(), $1, $2, 'seafarer', 'Placeholder headline', 'Placeholder summary for a test member.', now(), $3)
     returning id`,
    [name, `placeholder-learning-${sequence}`, residence],
  ))[0]!.id)
}

async function trainerApplication(userId: string) {
  return String((await run(
    `insert into public.learning_mentor_applications (
       user_id, applicant_name, current_last_rank, years_experience, vessel_types, specialization,
       certifications, short_bio, proposed_course_topics, status
     ) values ($1, 'Placeholder Trainer', 'Master Mariner', 20, '{Tanker}', 'Vetting and inspections',
       '{CoC Master}', 'A placeholder trainer used only by this test.', '{SIRE 2.0}', 'pending')
     returning id`,
    [userId],
  ))[0]!.id)
}

/** A submitted course: an organization's (companyCountry) or an individual creator's (their residence). */
async function submittedCourse(input: { companyCountry?: string | null; creatorResidence?: string | null }) {
  sequence += 1
  // An individual course is a trainer's: the shared fixture makes an active trainer; their residence is set here.
  const trainer = input.companyCountry === undefined ? await createActiveMentor(run) : null
  const creator = trainer?.userId ?? await profile('Placeholder Creator', input.creatorResidence ?? null)
  if (trainer) await run(`update public.profiles set country_of_residence = $2 where id = $1`, [creator, input.creatorResidence ?? null])
  const company = input.companyCountry === undefined ? null : String((await run(
    `insert into public.companies (slug, name, created_by, country) values ($1, 'Placeholder Training Org', $2, $3) returning id`,
    [`placeholder-training-org-${sequence}`, creator, input.companyCountry],
  ))[0]!.id)
  const mentor = trainer?.mentorId ?? null
  const courseId = String((await run(
    `insert into public.learning_courses (company_id, mentor_id, created_by_user_id, slug, title, description, category, level, access_type, price_minor, currency, certificate_enabled, status)
     values ($1, $2, $3, $4, 'Placeholder Course', 'A placeholder course used only by this test.', 'Vetting & Inspections', 'beginner', 'free', 0, 'INR', false, 'submitted')
     returning id`,
    [company, mentor, creator, `placeholder-course-${sequence}`],
  ))[0]!.id)
  return courseId
}

async function rating(courseId: string) {
  const learner = await profile('Placeholder Learner', null)
  return String((await run(
    `insert into public.learning_course_reviews (course_id, learner_id, rating, body, status, owner_reply, owner_replied_at)
     values ($1, $2, 4, 'Placeholder review text.', 'pending', 'Placeholder owner reply.', now()) returning id`,
    [courseId, learner],
  ))[0]!.id)
}

const learning = () => createLearningAdminRepository({ query: run, transaction })
const ratings = () => createCourseRatingRepository({ query: run, transaction })
const countryAdmins = () => createCountryAdminRepository({ query: run, transaction })

beforeAll(async () => {
  db = await createTestDatabase()
  platformAdmin = await profile('Placeholder Admin', null)
  await run(`insert into public.user_roles (user_id, role) values ($1, 'administrator')`, [platformAdmin])
  partner = await profile('Placeholder Partner', 'PH')
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('Learning for a Philippines country admin', () => {
  const ids: Record<string, string> = {}

  beforeAll(async () => {
    ids.manilaTrainer = await trainerApplication(await profile('Placeholder Manila Trainer', 'PH'))
    ids.kochiTrainer = await trainerApplication(await profile('Placeholder Kochi Trainer', 'IN'))
    // An organization course follows the organization's country, whatever the creator's residence.
    ids.phOrgCourse = await submittedCourse({ companyCountry: 'PH', creatorResidence: 'IN' })
    ids.inOrgCourse = await submittedCourse({ companyCountry: 'IN', creatorResidence: 'PH' })
    ids.phTrainerCourse = await submittedCourse({ creatorResidence: 'PH' })
    ids.noCountryCourse = await submittedCourse({ companyCountry: null })
    ids.phRating = await rating(ids.phOrgCourse)
    ids.inRating = await rating(ids.inOrgCourse)
  })

  it('is refused without the section; with it, lists only their countries', async () => {
    await countryAdmins().grant(platformAdmin, partner, ['PH'])
    await expect(learning().listMentorApplications(partner, 'pending')).rejects.toThrow('admin_forbidden')
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', learning: 'view' })

    expect((await learning().listMentorApplications(partner, 'pending')).map((entry) => entry.applicationId)).toEqual([ids.manilaTrainer])
    expect((await learning().listCoursesForReview(partner, 'submitted')).map((entry) => entry.courseId).sort())
      .toEqual([ids.phOrgCourse, ids.phTrainerCourse].sort())
    expect((await ratings().listPendingReviews(partner)).map((entry) => entry.id)).toEqual([ids.phRating])
    expect((await ratings().listReviewReplies(partner)).map((entry) => entry.reviewId)).toEqual([ids.phRating])
    expect((await learning().listCoursesForReview(platformAdmin, 'submitted')).length).toBe(4)
  })

  it('needs "act" to decide anything', async () => {
    await expect(learning().reviewMentorApplication(partner, ids.manilaTrainer!, 'approved', null)).rejects.toThrow('admin_forbidden')
    await expect(learning().reviewCourse(partner, ids.phOrgCourse!, 'approved', null)).rejects.toThrow('admin_forbidden')
    await expect(ratings().decideReview(partner, { reviewId: ids.phRating!, decision: 'approved', note: null })).rejects.toThrow('admin_forbidden')
    await expect(ratings().setReplyStatus(partner, { reviewId: ids.phRating!, status: 'hidden', note: null })).rejects.toThrow('admin_forbidden')
  })

  it('decides only their countries, and audits the section and country', async () => {
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', learning: 'act' })
    await expect(learning().reviewMentorApplication(partner, ids.kochiTrainer!, 'approved', null)).rejects.toThrow('learning_out_of_scope')
    await expect(learning().reviewCourse(partner, ids.inOrgCourse!, 'approved', null)).rejects.toThrow('learning_out_of_scope')
    await expect(learning().reviewCourse(partner, ids.noCountryCourse!, 'approved', null)).rejects.toThrow('learning_out_of_scope')
    await expect(ratings().decideReview(partner, { reviewId: ids.inRating!, decision: 'approved', note: null })).rejects.toThrow('learning_out_of_scope')
    await expect(ratings().setReplyStatus(partner, { reviewId: ids.inRating!, status: 'hidden', note: null })).rejects.toThrow('learning_out_of_scope')

    await learning().reviewMentorApplication(partner, ids.manilaTrainer!, 'approved', null)
    await learning().reviewCourse(partner, ids.phTrainerCourse!, 'approved', null)
    await ratings().decideReview(partner, { reviewId: ids.phRating!, decision: 'approved', note: null })
    await ratings().setReplyStatus(partner, { reviewId: ids.phRating!, status: 'hidden', note: 'Placeholder note.' })

    const audits = await run(
      `select action, metadata from public.audit_events
       where actor_id = $1 and action in ('learning.mentor_application.approved', 'learning.course.approved', 'moderation.course_review_approved', 'moderation.course_review_reply_hidden')
       order by id`,
      [partner],
    )
    expect(audits.map((row) => row.action)).toEqual([
      'learning.mentor_application.approved', 'learning.course.approved', 'moderation.course_review_approved', 'moderation.course_review_reply_hidden',
    ])
    for (const row of audits) expect(row.metadata).toMatchObject({ actorRole: 'country_admin', section: 'learning', country: 'PH' })
  })

  it('leaves platform administrators every power, the no-country course included', async () => {
    await learning().reviewCourse(platformAdmin, ids.noCountryCourse!, 'approved', null)
    const [audit] = await run(`select metadata from public.audit_events where target_id = $1 and action = 'learning.course.approved'`, [ids.noCountryCourse])
    expect(audit!.metadata).toMatchObject({ actorRole: 'platform_admin', section: 'learning', country: null })
  })
})

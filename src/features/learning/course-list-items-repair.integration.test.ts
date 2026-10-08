import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createActiveMentor, createPublishedCourse } from './learning-test-fixtures'

/**
 * Migration 0071 against the real schema (PGlite): course lists that the old comma-splitting Studio editor broke
 * apart are rejoined word for word, lists entered one item per line are left alone, and the originals are kept.
 */

const REPAIR_STATEMENTS = readFileSync(join(process.cwd(), 'infra/aws/database/migrations/0071_learning_course_list_items.sql'), 'utf8')
  .split('-- statement-breakpoint')
  .filter((statement) => statement.trim())

// The SIRE 2.0 course's lists as stored on seanshore.in before the repair.
const SPLIT_OUTCOMES = [
  'Explain how SIRE 2.0 differs from SIRE 1 and why vetting moved to a risk-based model',
  'Navigate the CVIQ and identify Core',
  'Rotational 1 and Rotational 2 questions',
  'Distinguish Human',
  'Process and Hardware factors and answer each type correctly',
  'Prepare and verify the pre-inspection questionnaire and vessel document pack',
]
const SPLIT_AUDIENCE = [
  'Deck officers and engineers on oil',
  'chemical and gas tankers',
  'Ratings and cadets preparing for their first inspection',
]
const REQUIREMENTS = [
  'Basic familiarity with tanker or merchant ship operations',
  'No prior SIRE inspection experience needed',
]

let db: TestDatabase

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

async function setLists(courseId: string, outcomes: string[], requirements: string[], audience: string[]) {
  await db.query(
    `update public.learning_courses set learning_outcomes = $2, requirements = $3, target_audience = $4 where id = $1`,
    [courseId, outcomes, requirements, audience],
  )
}

async function lists(courseId: string) {
  const rows = await db.query(
    `select learning_outcomes, requirements, target_audience from public.learning_courses where id = $1`,
    [courseId],
  )
  return rows[0] as { learning_outcomes: string[]; requirements: string[]; target_audience: string[] }
}

async function runRepair(statements = REPAIR_STATEMENTS) {
  for (const statement of statements) await db.query(statement)
}

describe('course list items repair (0071)', () => {
  it('rejoins comma-split items word for word and keeps the originals', async () => {
    const mentor = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, mentor)
    await setLists(course.courseId, SPLIT_OUTCOMES, REQUIREMENTS, SPLIT_AUDIENCE)

    await runRepair()

    expect(await lists(course.courseId)).toEqual({
      learning_outcomes: [
        'Explain how SIRE 2.0 differs from SIRE 1 and why vetting moved to a risk-based model',
        'Navigate the CVIQ and identify Core, Rotational 1 and Rotational 2 questions',
        'Distinguish Human, Process and Hardware factors and answer each type correctly',
        'Prepare and verify the pre-inspection questionnaire and vessel document pack',
      ],
      requirements: REQUIREMENTS,
      target_audience: [
        'Deck officers and engineers on oil, chemical and gas tankers',
        'Ratings and cadets preparing for their first inspection',
      ],
    })
    const backup = await db.query(
      `select learning_outcomes, requirements, target_audience from public.learning_course_list_items_backup where course_id = $1`,
      [course.courseId],
    )
    expect(backup[0]).toEqual({ learning_outcomes: SPLIT_OUTCOMES, requirements: REQUIREMENTS, target_audience: SPLIT_AUDIENCE })

    // A second run changes nothing.
    const repaired = await lists(course.courseId)
    await runRepair()
    expect(await lists(course.courseId)).toEqual(repaired)
  }, 120_000)

  it('leaves lists entered one item per line untouched, commas included', async () => {
    const mentor = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, mentor)
    const outcomes = ['Navigate the CVIQ and identify Core, Rotational 1 and Rotational 2 questions', 'Lead the closing meeting']
    await setLists(course.courseId, outcomes, [], ['Deck officers and engineers on oil, chemical and gas tankers'])

    await runRepair()

    expect(await lists(course.courseId)).toEqual({
      learning_outcomes: outcomes,
      requirements: [],
      target_audience: ['Deck officers and engineers on oil, chemical and gas tankers'],
    })
    expect(await db.query(`select 1 from public.learning_course_list_items_backup where course_id = $1`, [course.courseId])).toHaveLength(0)
  }, 120_000)

  it('never overwrites a course edited after its lists were backed up', async () => {
    const mentor = await createActiveMentor(db.query)
    const course = await createPublishedCourse(db.query, mentor)
    await setLists(course.courseId, SPLIT_OUTCOMES, REQUIREMENTS, SPLIT_AUDIENCE)

    // Back up only, then the trainer saves new lists before the rewrite runs.
    await runRepair(REPAIR_STATEMENTS.slice(0, 2))
    const edited = ['A new outcome the trainer typed, with a comma']
    await setLists(course.courseId, edited, REQUIREMENTS, SPLIT_AUDIENCE)
    await runRepair(REPAIR_STATEMENTS.slice(2))

    expect((await lists(course.courseId)).learning_outcomes).toEqual(edited)
  }, 120_000)
})

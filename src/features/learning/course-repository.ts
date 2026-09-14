import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { canMentorEditCourse, canTransitionCourseStatus, type CourseStatus } from './course-workflow'

type CourseQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type CourseTransaction = <T>(work: (query: CourseQuery) => Promise<T>) => Promise<T>

type MentorRow = QueryResultRow & { id: string }
type ReturningIdRow = QueryResultRow & { id: string }
type OwnedCourseRow = QueryResultRow & {
  id: string
  slug: string
  title: string
  subtitle: string | null
  category: string
  level: CourseDraftInput['level']
  course_format: CourseDraftInput['courseFormat']
  access_type: CourseDraftInput['accessType']
  status: string
  admin_review_note: string | null
  updated_at: string | Date
}
type OwnedCourseDetailRow = QueryResultRow & {
  id: string
  slug: string
  title: string
  subtitle: string | null
  description: string
  category: string
  level: CourseDraftInput['level']
  language: string
  thumbnail_path: string | null
  trailer_path: string | null
  learning_outcomes: string[] | null
  requirements: string[] | null
  target_audience: string[] | null
  price_minor: string | number
  discount_price_minor: string | number | null
  currency: string
  access_type: CourseDraftInput['accessType']
  certificate_enabled: boolean
  course_format: CourseDraftInput['courseFormat']
  status: string
  admin_review_note: string | null
  updated_at: string | Date
}
type LockedCourseRow = QueryResultRow & {
  id: string
  status: string
  mentor_id: string
}
type SubmissionReadinessRow = QueryResultRow & {
  section_id: string
  section_title: string
  section_position: string | number
  lesson_id: string | null
  lesson_title: string | null
  lesson_type: string | null
  lesson_position: string | number | null
  article_body: string | null
  asset_path: string | null
  external_url: string | null
  quiz_id: string | null
  pass_percentage: string | number | null
  question_id: string | null
  question_position: string | number | null
  option_id: string | null
  option_is_correct: boolean | null
}

type ReadinessLesson = {
  id: string
  title: string
  lessonType: string
  articleBody: string | null
  assetPath: string | null
  externalUrl: string | null
  quiz: null | {
    id: string
    passPercentage: number
    questions: Map<string, {
      position: number
      options: Map<string, boolean>
    }>
  }
}

type ReadinessSection = {
  id: string
  title: string
  lessons: Map<string, ReadinessLesson>
}

export type CourseSubmissionReadinessCode =
  | 'course_curriculum_empty'
  | 'course_section_empty'
  | 'course_lesson_content_missing'
  | 'course_activity_not_supported'
  | 'course_quiz_missing'
  | 'course_quiz_pass_invalid'
  | 'course_quiz_questions_missing'
  | 'course_quiz_options_invalid'
  | 'course_quiz_correct_answer_invalid'

export class CourseSubmissionReadinessError extends Error {
  readonly code: CourseSubmissionReadinessCode
  readonly details: Record<string, string | number>

  constructor(code: CourseSubmissionReadinessCode, details: Record<string, string | number> = {}) {
    super(code)
    this.name = 'CourseSubmissionReadinessError'
    this.code = code
    this.details = details
  }
}

export type CourseDraftInput = {
  slug: string
  title: string
  subtitle: string | null
  description: string
  category: string
  level: 'beginner' | 'intermediate' | 'advanced' | 'all_levels'
  language: string
  thumbnailPath: string | null
  trailerPath: string | null
  learningOutcomes: string[]
  requirements: string[]
  targetAudience: string[]
  accessType: 'free' | 'paid'
  priceMinor: number
  discountPriceMinor: number | null
  currency: string
  certificateEnabled: boolean
  courseFormat: 'recorded' | 'live_cohort' | 'hybrid'
}

export type MentorCourseSummary = {
  id: string
  slug: string
  title: string
  subtitle: string | null
  category: string
  level: CourseDraftInput['level']
  courseFormat: CourseDraftInput['courseFormat']
  accessType: CourseDraftInput['accessType']
  status: CourseStatus
  adminReviewNote: string | null
  updatedAt: string
}

export type MentorOwnedCourseDetail = CourseDraftInput & {
  id: string
  status: CourseStatus
  adminReviewNote: string | null
  updatedAt: string
}

function runtimeTransaction<T>(work: (query: CourseQuery) => Promise<T>) {
  return databaseTransaction(async (client: DatabaseQueryClient) => work(async (text, values) => {
    const result = await client.query(text, values)
    return result.rows
  }))
}

function asCourseStatus(value: string): CourseStatus {
  if (
    value === 'draft'
    || value === 'submitted'
    || value === 'changes_requested'
    || value === 'approved'
    || value === 'published'
    || value === 'archived'
  ) return value
  throw new Error('course_status_invalid')
}

function isoDateTime(value: string | Date) {
  return value instanceof Date ? value.toISOString() : value
}

function courseValues(mentorId: string, input: CourseDraftInput) {
  return [
    mentorId,
    input.slug,
    input.title,
    input.subtitle,
    input.description,
    input.category,
    input.level,
    input.language,
    input.thumbnailPath,
    input.trailerPath,
    input.learningOutcomes,
    input.requirements,
    input.targetAudience,
    input.priceMinor,
    input.discountPriceMinor,
    input.currency,
    input.accessType,
    input.certificateEnabled,
    input.courseFormat,
  ] as const
}

function buildSubmissionReadiness(rows: SubmissionReadinessRow[]) {
  const sections = new Map<string, ReadinessSection>()

  for (const row of rows) {
    let section = sections.get(row.section_id)
    if (!section) {
      section = { id: row.section_id, title: row.section_title, lessons: new Map() }
      sections.set(row.section_id, section)
    }

    if (!row.lesson_id || !row.lesson_title || !row.lesson_type) continue

    let lesson = section.lessons.get(row.lesson_id)
    if (!lesson) {
      lesson = {
        id: row.lesson_id,
        title: row.lesson_title,
        lessonType: row.lesson_type,
        articleBody: row.article_body,
        assetPath: row.asset_path,
        externalUrl: row.external_url,
        quiz: row.quiz_id && row.pass_percentage !== null
          ? {
              id: row.quiz_id,
              passPercentage: Number(row.pass_percentage),
              questions: new Map(),
            }
          : null,
      }
      section.lessons.set(row.lesson_id, lesson)
    }

    if (!lesson.quiz || !row.question_id || row.question_position === null) continue
    let question = lesson.quiz.questions.get(row.question_id)
    if (!question) {
      question = {
        position: Number(row.question_position),
        options: new Map(),
      }
      lesson.quiz.questions.set(row.question_id, question)
    }
    if (row.option_id && row.option_is_correct !== null) {
      question.options.set(row.option_id, row.option_is_correct)
    }
  }

  return sections
}

function validateSubmissionReadiness(rows: SubmissionReadinessRow[]) {
  const sections = buildSubmissionReadiness(rows)
  if (sections.size === 0) {
    throw new CourseSubmissionReadinessError('course_curriculum_empty')
  }

  for (const section of sections.values()) {
    if (section.lessons.size === 0) {
      throw new CourseSubmissionReadinessError('course_section_empty', { sectionTitle: section.title })
    }

    for (const lesson of section.lessons.values()) {
      if (lesson.lessonType === 'assignment' || lesson.lessonType === 'live_session') {
        throw new CourseSubmissionReadinessError('course_activity_not_supported', {
          lessonTitle: lesson.title,
          lessonType: lesson.lessonType,
        })
      }

      if (lesson.lessonType === 'article' && !lesson.articleBody?.trim()) {
        throw new CourseSubmissionReadinessError('course_lesson_content_missing', {
          lessonTitle: lesson.title,
          lessonType: lesson.lessonType,
        })
      }

      if (
        ['video', 'audio', 'pdf', 'presentation_document', 'downloadable_resource'].includes(lesson.lessonType)
        && !lesson.assetPath?.trim()
        && !lesson.externalUrl?.trim()
      ) {
        throw new CourseSubmissionReadinessError('course_lesson_content_missing', {
          lessonTitle: lesson.title,
          lessonType: lesson.lessonType,
        })
      }

      if (lesson.lessonType !== 'quiz') continue
      if (!lesson.quiz) {
        throw new CourseSubmissionReadinessError('course_quiz_missing', { lessonTitle: lesson.title })
      }
      if (!Number.isInteger(lesson.quiz.passPercentage) || lesson.quiz.passPercentage < 1 || lesson.quiz.passPercentage > 100) {
        throw new CourseSubmissionReadinessError('course_quiz_pass_invalid', { lessonTitle: lesson.title })
      }
      if (lesson.quiz.questions.size === 0) {
        throw new CourseSubmissionReadinessError('course_quiz_questions_missing', { lessonTitle: lesson.title })
      }

      for (const question of lesson.quiz.questions.values()) {
        const questionNumber = question.position + 1
        if (question.options.size < 2) {
          throw new CourseSubmissionReadinessError('course_quiz_options_invalid', {
            lessonTitle: lesson.title,
            questionNumber,
          })
        }
        const correctAnswers = [...question.options.values()].filter(Boolean).length
        if (correctAnswers !== 1) {
          throw new CourseSubmissionReadinessError('course_quiz_correct_answer_invalid', {
            lessonTitle: lesson.title,
            questionNumber,
          })
        }
      }
    }
  }
}

export function createCourseRepository(input: {
  query?: CourseQuery
  transaction?: CourseTransaction
} = {}) {
  const queryRows: CourseQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))
  const transaction = input.transaction ?? runtimeTransaction

  async function requireActiveMentor(actorId: string, query: CourseQuery = queryRows) {
    const rows = await query(
      `select id
       from public.learning_mentors
       where user_id = $1
         and status = 'active'
       limit 1`,
      [actorId],
    ) as MentorRow[]
    const mentor = rows[0]
    if (!mentor) throw new Error('mentor_required')
    return mentor
  }

  async function createCourse(actorId: string, draft: CourseDraftInput) {
    const mentor = await requireActiveMentor(actorId)
    const rows = await queryRows(
      `insert into public.learning_courses (
         mentor_id,
         slug,
         title,
         subtitle,
         description,
         category,
         level,
         language,
         thumbnail_path,
         trailer_path,
         learning_outcomes,
         requirements,
         target_audience,
         price_minor,
         discount_price_minor,
         currency,
         access_type,
         certificate_enabled,
         course_format,
         status,
         created_at,
         updated_at
       )
       values (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
         now(), now()
       )
       returning id`,
      [...courseValues(mentor.id, draft), 'draft'],
    ) as ReturningIdRow[]
    const created = rows[0]
    if (!created) throw new Error('course_create_failed')
    return { courseId: created.id }
  }

  async function listOwnedCourses(actorId: string): Promise<MentorCourseSummary[]> {
    const rows = await queryRows(
      `select
         course.id,
         course.slug,
         course.title,
         course.subtitle,
         course.category,
         course.level,
         course.course_format,
         course.access_type,
         course.status,
         course.admin_review_note,
         course.updated_at
       from public.learning_courses course
       inner join public.learning_mentors mentor
         on mentor.id = course.mentor_id
       where mentor.user_id = $1
         and mentor.status = 'active'
       order by course.updated_at desc, course.id desc`,
      [actorId],
    ) as OwnedCourseRow[]

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      category: row.category,
      level: row.level,
      courseFormat: row.course_format,
      accessType: row.access_type,
      status: asCourseStatus(row.status),
      adminReviewNote: row.admin_review_note,
      updatedAt: isoDateTime(row.updated_at),
    }))
  }

  async function getOwnedCourse(actorId: string, courseId: string): Promise<MentorOwnedCourseDetail | null> {
    const rows = await queryRows(
      `select
         course.id,
         course.slug,
         course.title,
         course.subtitle,
         course.description,
         course.category,
         course.level,
         course.language,
         course.thumbnail_path,
         course.trailer_path,
         course.learning_outcomes,
         course.requirements,
         course.target_audience,
         course.price_minor,
         course.discount_price_minor,
         course.currency,
         course.access_type,
         course.certificate_enabled,
         course.course_format,
         course.status,
         course.admin_review_note,
         course.updated_at
       from public.learning_courses course
       inner join public.learning_mentors mentor
         on mentor.id = course.mentor_id
       where mentor.user_id = $1
         and mentor.status = 'active'
         and course.id = $2
       limit 1`,
      [actorId, courseId],
    ) as OwnedCourseDetailRow[]
    const row = rows[0]
    if (!row) return null

    return {
      id: row.id,
      slug: row.slug,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      category: row.category,
      level: row.level,
      language: row.language,
      thumbnailPath: row.thumbnail_path,
      trailerPath: row.trailer_path,
      learningOutcomes: row.learning_outcomes ?? [],
      requirements: row.requirements ?? [],
      targetAudience: row.target_audience ?? [],
      priceMinor: Number(row.price_minor),
      discountPriceMinor: row.discount_price_minor === null ? null : Number(row.discount_price_minor),
      currency: row.currency,
      accessType: row.access_type,
      certificateEnabled: row.certificate_enabled,
      courseFormat: row.course_format,
      status: asCourseStatus(row.status),
      adminReviewNote: row.admin_review_note,
      updatedAt: isoDateTime(row.updated_at),
    }
  }

  async function updateCourse(actorId: string, courseId: string, draft: CourseDraftInput) {
    return transaction(async (txQuery) => {
      const lockedRows = await txQuery(
        `select course.id, course.status, course.mentor_id
         from public.learning_courses course
         inner join public.learning_mentors mentor
           on mentor.id = course.mentor_id
         where course.id = $1
           and mentor.user_id = $2
           and mentor.status = 'active'
         for update`,
        [courseId, actorId],
      ) as LockedCourseRow[]
      const current = lockedRows[0]
      if (!current) throw new Error('course_not_found')
      if (!canMentorEditCourse(asCourseStatus(current.status))) throw new Error('course_edit_forbidden')

      const rows = await txQuery(
        `update public.learning_courses
         set slug = $3,
             title = $4,
             subtitle = $5,
             description = $6,
             category = $7,
             level = $8,
             language = $9,
             thumbnail_path = $10,
             trailer_path = $11,
             learning_outcomes = $12,
             requirements = $13,
             target_audience = $14,
             price_minor = $15,
             discount_price_minor = $16,
             currency = $17,
             access_type = $18,
             certificate_enabled = $19,
             course_format = $20,
             updated_at = now()
         where id = $1
           and mentor_id = $2
         returning id`,
        [courseId, ...courseValues(current.mentor_id, draft)],
      ) as ReturningIdRow[]
      if (!rows[0]) throw new Error('course_update_failed')
      return true
    })
  }

  async function submitCourse(actorId: string, courseId: string) {
    return transaction(async (txQuery) => {
      const lockedRows = await txQuery(
        `select course.id, course.status, course.mentor_id
         from public.learning_courses course
         inner join public.learning_mentors mentor
           on mentor.id = course.mentor_id
         where course.id = $1
           and mentor.user_id = $2
           and mentor.status = 'active'
         for update`,
        [courseId, actorId],
      ) as LockedCourseRow[]
      const current = lockedRows[0]
      if (!current) throw new Error('course_not_found')

      const currentStatus = asCourseStatus(current.status)
      if (!canTransitionCourseStatus({ actor: 'mentor', current: currentStatus, next: 'submitted' })) {
        throw new Error('course_submit_forbidden')
      }

      const readinessRows = await txQuery(
        `select
           section.id as section_id,
           section.title as section_title,
           section.position as section_position,
           lesson.id as lesson_id,
           lesson.title as lesson_title,
           lesson.lesson_type,
           lesson.position as lesson_position,
           lesson.article_body,
           lesson.asset_path,
           lesson.external_url,
           quiz.id as quiz_id,
           quiz.pass_percentage,
           question.id as question_id,
           question.position as question_position,
           option.id as option_id,
           option.is_correct as option_is_correct
         from public.learning_course_sections section
         left join public.learning_lessons lesson
           on lesson.section_id = section.id
         left join public.learning_quizzes quiz
           on quiz.lesson_id = lesson.id
         left join public.learning_quiz_questions question
           on question.quiz_id = quiz.id
         left join public.learning_quiz_options option
           on option.question_id = question.id
         where section.course_id = $1
         order by
           section.position asc,
           section.id asc,
           lesson.position asc nulls last,
           lesson.id asc nulls last,
           question.position asc nulls last,
           question.id asc nulls last,
           option.position asc nulls last,
           option.id asc nulls last`,
        [courseId],
      ) as SubmissionReadinessRow[]
      validateSubmissionReadiness(readinessRows)

      const rows = await txQuery(
        `update public.learning_courses
         set status = 'submitted',
             reviewed_by = null,
             reviewed_at = null,
             admin_review_note = null,
             approved_at = null,
             updated_at = now()
         where id = $1
           and mentor_id = $2
         returning id`,
        [courseId, current.mentor_id],
      ) as ReturningIdRow[]
      if (!rows[0]) throw new Error('course_submit_failed')
      return true
    })
  }

  return {
    createCourse,
    listOwnedCourses,
    getOwnedCourse,
    updateCourse,
    submitCourse,
  }
}

export const courseRepository = createCourseRepository()

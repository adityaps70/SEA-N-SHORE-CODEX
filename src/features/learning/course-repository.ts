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
  company_id: string | null
  publisher_name: string
  publisher_slug: string | null
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
  company_id: string | null
  publisher_name: string
  publisher_slug: string | null
}
type LockedCourseRow = QueryResultRow & {
  id: string
  status: string
  mentor_id: string | null
  company_id: string | null
}
type CoursePublisherScopeRow = QueryResultRow & {
  company_id: string | null
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
  is_published: boolean | null
  release_mode: string | null
  release_at: string | Date | null
  drip_delay_days: string | number | null
  prerequisite_lesson_id: string | null
  completion_rule: string | null
  completion_threshold: string | number | null
  max_attempts: string | number | null
  embed_kind: string | null
  assignment_instructions: string | null
  assignment_extensions: string[] | null
  assignment_max_upload_bytes: string | number | null
  scorm_status: string | null
  scorm_source_zip_path: string | null
  scorm_launch_path: string | null
  scorm_processing_error: string | null
  quiz_id: string | null
  pass_percentage: string | number | null
  question_id: string | null
  question_position: string | number | null
  option_id: string | null
  option_is_correct: boolean | null
}

type ReadinessMaterial = {
  id: string
  title: string
  materialType: string
  articleBody: string | null
  assetPath: string | null
  externalUrl: string | null
  isPublished: boolean
  releaseMode: string
  releaseAt: string | Date | null
  dripDelayDays: number | null
  prerequisiteLessonId: string | null
  completionRule: string
  completionThreshold: number | null
  maxAttempts: number | null
  embedKind: string | null
  assignment: null | {
    instructions: string
    acceptedExtensions: string[]
    maxUploadBytes: number
  }
  scorm: null | {
    status: string
    sourceZipPath: string | null
    launchPath: string | null
    processingError: string | null
  }
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
  materials: Map<string, ReadinessMaterial>
}

export type CourseSubmissionReadinessCode =
  | 'course_curriculum_empty'
  | 'course_section_empty'
  | 'course_lesson_content_missing'
  | 'course_material_content_missing'
  | 'course_material_release_invalid'
  | 'course_material_prerequisite_invalid'
  | 'course_material_completion_invalid'
  | 'course_assignment_missing'
  | 'course_scorm_not_ready'
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

export type CourseCreateInput = CourseDraftInput & (
  | { publisherType: 'personal'; companyId: null }
  | { publisherType: 'organization'; companyId: string }
)

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
  publisherType: 'personal' | 'organization'
  companyId: string | null
  publisherName: string
  publisherSlug: string | null
}

export type MentorOwnedCourseDetail = CourseDraftInput & {
  id: string
  status: CourseStatus
  adminReviewNote: string | null
  updatedAt: string
  publisherType: 'personal' | 'organization'
  companyId: string | null
  publisherName: string
  publisherSlug: string | null
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

function courseValues(input: CourseDraftInput) {
  return [
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

function isCourseCreateInput(input: CourseDraftInput | CourseCreateInput): input is CourseCreateInput {
  return 'publisherType' in input
}

function courseManagerAccessSql(courseAlias: string, actorParam: string) {
  return `(
    exists (
      select 1
      from public.learning_mentors access_mentor
      where access_mentor.id = ${courseAlias}.mentor_id
        and access_mentor.user_id = ${actorParam}
        and access_mentor.status = 'active'
    )
    or (
      ${courseAlias}.company_id is not null
      and exists (
        select 1
        from public.company_members access_cm
        where access_cm.company_id = ${courseAlias}.company_id
          and access_cm.user_id = ${actorParam}
          and access_cm.approved_at is not null
          and access_cm.role::text in ('owner', 'administrator', 'lms_manager')
      )
    )
  )`
}

function buildSubmissionReadiness(rows: SubmissionReadinessRow[]) {
  const sections = new Map<string, ReadinessSection>()

  for (const row of rows) {
    let section = sections.get(row.section_id)
    if (!section) {
      section = { id: row.section_id, title: row.section_title, materials: new Map() }
      sections.set(row.section_id, section)
    }

    if (!row.lesson_id || !row.lesson_title || !row.lesson_type) continue

    let material = section.materials.get(row.lesson_id)
    if (!material) {
      material = {
        id: row.lesson_id,
        title: row.lesson_title,
        materialType: row.lesson_type,
        articleBody: row.article_body,
        assetPath: row.asset_path,
        externalUrl: row.external_url,
        isPublished: row.is_published === true,
        releaseMode: row.release_mode ?? 'immediate',
        releaseAt: row.release_at,
        dripDelayDays: row.drip_delay_days === null ? null : Number(row.drip_delay_days),
        prerequisiteLessonId: row.prerequisite_lesson_id,
        completionRule: row.completion_rule ?? 'manual',
        completionThreshold: row.completion_threshold === null ? null : Number(row.completion_threshold),
        maxAttempts: row.max_attempts === null ? null : Number(row.max_attempts),
        embedKind: row.embed_kind,
        assignment: row.assignment_instructions === null || row.assignment_max_upload_bytes === null
          ? null
          : {
              instructions: row.assignment_instructions,
              acceptedExtensions: row.assignment_extensions ?? [],
              maxUploadBytes: Number(row.assignment_max_upload_bytes),
            },
        scorm: row.scorm_status === null
          ? null
          : {
              status: row.scorm_status,
              sourceZipPath: row.scorm_source_zip_path,
              launchPath: row.scorm_launch_path,
              processingError: row.scorm_processing_error,
            },
        quiz: row.quiz_id && row.pass_percentage !== null
          ? {
              id: row.quiz_id,
              passPercentage: Number(row.pass_percentage),
              questions: new Map(),
            }
          : null,
      }
      section.materials.set(row.lesson_id, material)
    }

    if (!material.quiz || !row.question_id || row.question_position === null) continue
    let question = material.quiz.questions.get(row.question_id)
    if (!question) {
      question = {
        position: Number(row.question_position),
        options: new Map(),
      }
      material.quiz.questions.set(row.question_id, question)
    }
    if (row.option_id && row.option_is_correct !== null) {
      question.options.set(row.option_id, row.option_is_correct)
    }
  }

  return sections
}

function releasePolicyIsValid(material: ReadinessMaterial) {
  if (material.releaseMode === 'immediate') {
    return material.releaseAt === null && material.dripDelayDays === null
  }
  if (material.releaseMode === 'scheduled') {
    return material.releaseAt !== null && material.dripDelayDays === null
  }
  if (material.releaseMode === 'drip') {
    return material.releaseAt === null
      && material.dripDelayDays !== null
      && Number.isInteger(material.dripDelayDays)
      && material.dripDelayDays >= 0
  }
  return false
}

function completionPolicyIsValid(material: ReadinessMaterial) {
  if (material.maxAttempts !== null && (!Number.isInteger(material.maxAttempts) || material.maxAttempts <= 0)) return false

  if (material.completionRule === 'media_percentage') {
    return ['video', 'audio'].includes(material.materialType)
      && material.completionThreshold !== null
      && Number.isInteger(material.completionThreshold)
      && material.completionThreshold >= 1
      && material.completionThreshold <= 100
  }
  if (material.completionRule === 'quiz_pass') return material.materialType === 'quiz' && material.completionThreshold === null
  if (material.completionRule === 'assignment_submit') return material.materialType === 'assignment' && material.completionThreshold === null
  if (material.completionRule === 'scorm_completion') return material.materialType === 'scorm' && material.completionThreshold === null
  if (material.completionRule !== 'manual' && material.completionRule !== 'view') return false
  if (material.completionThreshold !== null) return false
  return !['quiz', 'assignment', 'scorm'].includes(material.materialType)
}

function validateMaterialContent(material: ReadinessMaterial) {
  const details = { materialTitle: material.title, materialType: material.materialType }

  if (material.materialType === 'live_session') {
    throw new CourseSubmissionReadinessError('course_activity_not_supported', details)
  }

  if (material.materialType === 'article' && !material.articleBody?.trim()) {
    throw new CourseSubmissionReadinessError('course_material_content_missing', details)
  }

  if (material.materialType === 'image' && !material.assetPath?.trim()) {
    throw new CourseSubmissionReadinessError('course_material_content_missing', details)
  }

  if (
    ['video', 'audio', 'pdf', 'presentation_document', 'downloadable_resource'].includes(material.materialType)
    && !material.assetPath?.trim()
    && !material.externalUrl?.trim()
  ) {
    throw new CourseSubmissionReadinessError('course_material_content_missing', details)
  }

  if (
    material.materialType === 'external_embed'
    && (
      !material.externalUrl?.trim()
      || !material.embedKind
      || !['youtube', 'vimeo', 'generic'].includes(material.embedKind)
    )
  ) {
    throw new CourseSubmissionReadinessError('course_material_content_missing', details)
  }

  if (material.materialType === 'assignment') {
    if (
      !material.assignment?.instructions.trim()
      || !Number.isFinite(material.assignment.maxUploadBytes)
      || material.assignment.maxUploadBytes <= 0
    ) {
      throw new CourseSubmissionReadinessError('course_assignment_missing', { materialTitle: material.title })
    }
  }

  if (material.materialType === 'scorm') {
    if (
      !material.assetPath?.trim()
      || !material.scorm
      || material.scorm.status !== 'ready'
      || !material.scorm.sourceZipPath?.trim()
      || !material.scorm.launchPath?.trim()
    ) {
      throw new CourseSubmissionReadinessError('course_scorm_not_ready', { materialTitle: material.title })
    }
  }
}

function validateQuiz(material: ReadinessMaterial) {
  if (!material.quiz) {
    throw new CourseSubmissionReadinessError('course_quiz_missing', { materialTitle: material.title })
  }
  if (!Number.isInteger(material.quiz.passPercentage) || material.quiz.passPercentage < 1 || material.quiz.passPercentage > 100) {
    throw new CourseSubmissionReadinessError('course_quiz_pass_invalid', { materialTitle: material.title })
  }
  if (material.quiz.questions.size === 0) {
    throw new CourseSubmissionReadinessError('course_quiz_questions_missing', { materialTitle: material.title })
  }

  for (const question of material.quiz.questions.values()) {
    const questionNumber = question.position + 1
    if (question.options.size < 2) {
      throw new CourseSubmissionReadinessError('course_quiz_options_invalid', {
        materialTitle: material.title,
        questionNumber,
      })
    }
    const correctAnswers = [...question.options.values()].filter(Boolean).length
    if (correctAnswers !== 1) {
      throw new CourseSubmissionReadinessError('course_quiz_correct_answer_invalid', {
        materialTitle: material.title,
        questionNumber,
      })
    }
  }
}

function validateSubmissionReadiness(rows: SubmissionReadinessRow[]) {
  const sections = buildSubmissionReadiness(rows)
  if (sections.size === 0) {
    throw new CourseSubmissionReadinessError('course_curriculum_empty')
  }

  const publishedMaterialIds = new Set<string>()
  for (const section of sections.values()) {
    for (const material of section.materials.values()) {
      if (material.isPublished) publishedMaterialIds.add(material.id)
    }
  }

  for (const section of sections.values()) {
    const publishedMaterials = [...section.materials.values()].filter((material) => material.isPublished)
    if (publishedMaterials.length === 0) {
      throw new CourseSubmissionReadinessError('course_section_empty', { sectionTitle: section.title })
    }

    for (const material of publishedMaterials) {
      validateMaterialContent(material)

      if (!releasePolicyIsValid(material)) {
        throw new CourseSubmissionReadinessError('course_material_release_invalid', { materialTitle: material.title })
      }

      if (
        material.prerequisiteLessonId !== null
        && (
          material.prerequisiteLessonId === material.id
          || !publishedMaterialIds.has(material.prerequisiteLessonId)
        )
      ) {
        throw new CourseSubmissionReadinessError('course_material_prerequisite_invalid', { materialTitle: material.title })
      }

      if (!completionPolicyIsValid(material)) {
        throw new CourseSubmissionReadinessError('course_material_completion_invalid', { materialTitle: material.title })
      }

      if (material.materialType === 'quiz') validateQuiz(material)
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
           lesson.is_published,
           lesson.release_mode,
           lesson.release_at,
           lesson.drip_delay_days,
           lesson.prerequisite_lesson_id,
           lesson.completion_rule,
           lesson.completion_threshold,
           lesson.max_attempts,
           lesson.embed_kind,
           assignment.instructions as assignment_instructions,
           assignment.accepted_extensions as assignment_extensions,
           assignment.max_upload_bytes as assignment_max_upload_bytes,
           scorm.status as scorm_status,
           scorm.source_zip_path as scorm_source_zip_path,
           scorm.launch_path as scorm_launch_path,
           scorm.processing_error as scorm_processing_error,
           quiz.id as quiz_id,
           quiz.pass_percentage,
           question.id as question_id,
           question.position as question_position,
           option.id as option_id,
           option.is_correct as option_is_correct
         from public.learning_course_sections section
         left join public.learning_lessons lesson
           on lesson.section_id = section.id
         left join public.learning_assignments assignment
           on assignment.lesson_id = lesson.id
         left join public.learning_scorm_packages scorm
           on scorm.lesson_id = lesson.id
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

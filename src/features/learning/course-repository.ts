import type { QueryResultRow } from 'pg'
import { query as databaseQuery, withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { canMentorEditCourse, canTransitionCourseStatus, type CourseStatus } from './course-workflow'
import { courseManagerAccessSql } from './course-access'
import {
  snapshotDetailsFromRow,
  snapshotSectionsFromRows,
  type CourseReviewSnapshot,
} from './course-review-snapshot'

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
  details_revision?: string | number | null
  reviewed_at?: string | Date | null
  last_review_outcome?: string | null
  last_review_note?: string | null
  last_review_at?: string | Date | null
  pending_submitted_at?: string | Date | null
}
type LockedCourseRow = QueryResultRow & {
  id: string
  status: string
  mentor_id: string | null
  company_id: string | null
  details_revision?: string | number | null
}
type UpdatedCourseRow = QueryResultRow & {
  id: string
  details_revision?: string | number | null
  updated_at?: string | Date | null
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
  lesson_summary?: string | null
  quiz_instructions?: string | null
  question_prompt?: string | null
  option_label?: string | null
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

/** A save or other change was refused because the course is not editable in its current status. */
export class CourseEditLockedError extends Error {
  readonly status: CourseStatus

  constructor(status: CourseStatus) {
    super('course_edit_forbidden')
    this.name = 'CourseEditLockedError'
    this.status = status
  }
}

/** A details save was based on an older revision than the one stored (another tab or manager saved first). */
export class CourseEditConflictError extends Error {
  readonly currentRevision: number

  constructor(currentRevision: number) {
    super('course_edit_conflict')
    this.name = 'CourseEditConflictError'
    this.currentRevision = currentRevision
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

export type CourseLastReview = {
  decision: 'changes_requested' | 'approved'
  note: string | null
  reviewedAt: string | null
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
  /** Optimistic-concurrency token for the details form; send it back with every save. */
  detailsRevision: number
  /** The most recent reviewer decision, kept after the trainer resubmits. */
  lastReview: CourseLastReview | null
  /** When the course was last sent for review, while it is in review. */
  submittedAt: string | null
}

export type CourseDetailsSaveResult = {
  revision: number
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

function nullableIso(value: string | Date | null | undefined) {
  if (value === null || value === undefined) return null
  return isoDateTime(value)
}

function revisionNumber(value: string | number | null | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : 1
}

function lastReviewFromRow(row: OwnedCourseDetailRow): CourseLastReview | null {
  if (row.last_review_outcome === 'changes_requested' || row.last_review_outcome === 'approved') {
    return {
      decision: row.last_review_outcome,
      note: row.last_review_note ?? null,
      reviewedAt: nullableIso(row.last_review_at),
    }
  }
  // Courses reviewed before submission history existed keep their note on the course row.
  if (row.admin_review_note && (row.status === 'changes_requested' || row.status === 'published' || row.status === 'approved')) {
    return {
      decision: row.status === 'changes_requested' ? 'changes_requested' : 'approved',
      note: row.admin_review_note,
      reviewedAt: nullableIso(row.reviewed_at),
    }
  }
  return null
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

  async function requireOrganizationLmsManager(
    actorId: string,
    companyId: string,
    query: CourseQuery = queryRows,
  ) {
    const rows = await query(
      `select role::text as role, approved_at
       from public.company_members
       where company_id = $1
         and user_id = $2
         and approved_at is not null
         and role::text in ('owner', 'administrator', 'lms_manager')
       limit 1`,
      [companyId, actorId],
    )
    if (!rows[0]) throw new Error('course_forbidden')
    return true
  }

  async function createCourse(actorId: string, draft: CourseDraftInput | CourseCreateInput) {
    const publisherType = isCourseCreateInput(draft) ? draft.publisherType : 'personal'
    const companyId = publisherType === 'organization' && isCourseCreateInput(draft) ? draft.companyId : null
    let mentorId: string | null = null

    if (publisherType === 'organization') {
      if (!companyId) throw new Error('course_forbidden')
      await requireOrganizationLmsManager(actorId, companyId)
    } else {
      const mentor = await requireActiveMentor(actorId)
      mentorId = mentor.id
    }

    const rows = await queryRows(
      `insert into public.learning_courses (
         mentor_id,
         created_by_user_id,
         company_id,
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
         $21, $22, now(), now()
       )
       returning id`,
      [mentorId, actorId, companyId, ...courseValues(draft), 'draft'],
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
         course.updated_at,
         course.company_id,
         case when course.company_id is null then creator.full_name else company.name end as publisher_name,
         case when course.company_id is null then creator.slug else company.slug end as publisher_slug
       from public.learning_courses course
       join public.profiles creator on creator.id = course.created_by_user_id
       left join public.companies company on company.id = course.company_id
       where ${courseManagerAccessSql('course', '$1')}
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
      publisherType: row.company_id ? 'organization' : 'personal',
      companyId: row.company_id ?? null,
      publisherName: row.publisher_name,
      publisherSlug: row.publisher_slug,
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
         course.updated_at,
         course.company_id,
         course.details_revision,
         course.reviewed_at,
         last_review.outcome as last_review_outcome,
         last_review.reviewer_note as last_review_note,
         last_review.reviewed_at as last_review_at,
         pending_submission.submitted_at as pending_submitted_at,
         case when course.company_id is null then creator.full_name else company.name end as publisher_name,
         case when course.company_id is null then creator.slug else company.slug end as publisher_slug
       from public.learning_courses course
       join public.profiles creator on creator.id = course.created_by_user_id
       left join public.companies company on company.id = course.company_id
       left join lateral (
         select submission.outcome, submission.reviewer_note, submission.reviewed_at
         from public.learning_course_submissions submission
         where submission.course_id = course.id
           and submission.outcome in ('changes_requested', 'approved')
         order by submission.reviewed_at desc nulls last, submission.submitted_at desc
         limit 1
       ) last_review on true
       left join lateral (
         select submission.submitted_at
         from public.learning_course_submissions submission
         where submission.course_id = course.id
           and submission.outcome = 'pending'
         order by submission.submitted_at desc
         limit 1
       ) pending_submission on true
       where course.id = $2
         and ${courseManagerAccessSql('course', '$1')}
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
      publisherType: row.company_id ? 'organization' : 'personal',
      companyId: row.company_id ?? null,
      publisherName: row.publisher_name,
      publisherSlug: row.publisher_slug,
      detailsRevision: revisionNumber(row.details_revision),
      lastReview: lastReviewFromRow(row),
      submittedAt: row.status === 'submitted' ? nullableIso(row.pending_submitted_at) : null,
    }
  }

  async function getManagedCoursePublisher(actorId: string, courseId: string) {
    const rows = await queryRows(
      `select course.company_id
       from public.learning_courses course
       where course.id = $2
         and ${courseManagerAccessSql('course', '$1')}
       limit 1`,
      [actorId, courseId],
    ) as CoursePublisherScopeRow[]

    const row = rows[0]
    return row ? { companyId: row.company_id ?? null } : null
  }

  async function lockManagedCourse(txQuery: CourseQuery, actorId: string, courseId: string) {
    const lockedRows = await txQuery(
      `select course.id, course.status, course.mentor_id, course.company_id, course.details_revision,
              course.slug, course.title, course.subtitle, course.description, course.category, course.level,
              course.language, course.thumbnail_path, course.trailer_path, course.learning_outcomes,
              course.requirements, course.target_audience, course.price_minor, course.discount_price_minor,
              course.currency, course.access_type, course.certificate_enabled, course.course_format
       from public.learning_courses course
       where course.id = $1
         and ${courseManagerAccessSql('course', '$2')}
       for update`,
      [courseId, actorId],
    ) as LockedCourseRow[]
    const current = lockedRows[0]
    if (!current) throw new Error('course_not_found')
    return current
  }

  /**
   * Saves the course details. Refuses (never silently drops) the save when the
   * course is not editable, or when `expectedRevision` is older than the stored
   * revision because someone saved in the meantime.
   */
  async function updateCourse(
    actorId: string,
    courseId: string,
    draft: CourseDraftInput,
    options: { expectedRevision?: number | null } = {},
  ): Promise<CourseDetailsSaveResult> {
    return transaction(async (txQuery) => {
      const current = await lockManagedCourse(txQuery, actorId, courseId)
      const status = asCourseStatus(current.status)
      if (!canMentorEditCourse(status)) throw new CourseEditLockedError(status)

      const storedRevision = revisionNumber(current.details_revision)
      if (
        options.expectedRevision !== undefined
        && options.expectedRevision !== null
        && options.expectedRevision !== storedRevision
      ) {
        throw new CourseEditConflictError(storedRevision)
      }

      const rows = await txQuery(
        `update public.learning_courses
         set slug = $2,
             title = $3,
             subtitle = $4,
             description = $5,
             category = $6,
             level = $7,
             language = $8,
             thumbnail_path = $9,
             trailer_path = $10,
             learning_outcomes = $11,
             requirements = $12,
             target_audience = $13,
             price_minor = $14,
             discount_price_minor = $15,
             currency = $16,
             access_type = $17,
             certificate_enabled = $18,
             course_format = $19,
             details_revision = details_revision + 1,
             updated_at = now()
         where id = $1
         returning id, details_revision, updated_at`,
        [courseId, ...courseValues(draft)],
      ) as UpdatedCourseRow[]
      const updated = rows[0]
      if (!updated) throw new Error('course_update_failed')
      return {
        revision: updated.details_revision === undefined || updated.details_revision === null
          ? storedRevision + 1
          : revisionNumber(updated.details_revision),
        updatedAt: nullableIso(updated.updated_at) ?? new Date().toISOString(),
      }
    })
  }

  /**
   * Sends the saved course for review. When `expectedRevision` is given, the
   * submission is refused if the stored details are not the version the
   * trainer just saved, so a review never runs against content they didn't see.
   * A snapshot of exactly what was submitted is stored for the reviewer.
   */
  async function submitCourse(
    actorId: string,
    courseId: string,
    options: { expectedRevision?: number | null } = {},
  ) {
    return transaction(async (txQuery) => {
      const current = await lockManagedCourse(txQuery, actorId, courseId)

      const currentStatus = asCourseStatus(current.status)
      if (!canTransitionCourseStatus({ actor: 'mentor', current: currentStatus, next: 'submitted' })) {
        throw new Error('course_submit_forbidden')
      }
      const storedRevision = revisionNumber(current.details_revision)
      if (
        options.expectedRevision !== undefined
        && options.expectedRevision !== null
        && options.expectedRevision !== storedRevision
      ) {
        throw new CourseEditConflictError(storedRevision)
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
           option.is_correct as option_is_correct,
           lesson.summary as lesson_summary,
           quiz.instructions as quiz_instructions,
           question.prompt as question_prompt,
           option.label as option_label
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

      const snapshot: CourseReviewSnapshot = {
        version: 1,
        details: snapshotDetailsFromRow(current),
        sections: snapshotSectionsFromRows(readinessRows),
      }
      // Close any submission left open by an older flow before opening the new one.
      await txQuery(
        `update public.learning_course_submissions
         set outcome = 'withdrawn',
             updated_at = now()
         where course_id = $1
           and outcome = 'pending'`,
        [courseId],
      )
      await txQuery(
        `insert into public.learning_course_submissions (
           course_id,
           submitted_by,
           submitted_at,
           details_revision,
           snapshot,
           outcome,
           updated_at
         )
         values ($1, $2, now(), $3, $4::jsonb, 'pending', now())`,
        [courseId, actorId, storedRevision, JSON.stringify(snapshot)],
      )

      const rows = await txQuery(
        `update public.learning_courses
         set status = 'submitted',
             reviewed_by = null,
             reviewed_at = null,
             admin_review_note = null,
             approved_at = null,
             updated_at = now()
         where id = $1
         returning id`,
        [courseId],
      ) as ReturningIdRow[]
      if (!rows[0]) throw new Error('course_submit_failed')
      return true
    })
  }

  /** Takes a course out of review so the trainer can edit it again. Content is kept as-is. */
  async function withdrawCourse(actorId: string, courseId: string) {
    return transaction(async (txQuery) => {
      const current = await lockManagedCourse(txQuery, actorId, courseId)
      const currentStatus = asCourseStatus(current.status)
      if (!canTransitionCourseStatus({ actor: 'mentor', current: currentStatus, next: 'draft' })) {
        throw new Error('course_withdraw_forbidden')
      }

      await txQuery(
        `update public.learning_course_submissions
         set outcome = 'withdrawn',
             updated_at = now()
         where course_id = $1
           and outcome = 'pending'`,
        [courseId],
      )
      const rows = await txQuery(
        `update public.learning_courses
         set status = 'draft',
             updated_at = now()
         where id = $1
           and status = 'submitted'
         returning id`,
        [courseId],
      ) as ReturningIdRow[]
      if (!rows[0]) throw new Error('course_withdraw_forbidden')
      return true
    })
  }

  return {
    createCourse,
    listOwnedCourses,
    getOwnedCourse,
    getManagedCoursePublisher,
    updateCourse,
    submitCourse,
    withdrawCourse,
  }
}

export const courseRepository = createCourseRepository()

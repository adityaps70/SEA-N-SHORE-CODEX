/**
 * A frozen copy of what a trainer submitted for review, stored with each
 * submission (learning_course_submissions.snapshot). Comparing two snapshots
 * tells the reviewer what changed since the last review.
 */

export type CourseSnapshotDetails = {
  slug: string
  title: string
  subtitle: string | null
  description: string
  category: string
  level: string
  language: string
  thumbnailPath: string | null
  trailerPath: string | null
  learningOutcomes: string[]
  requirements: string[]
  targetAudience: string[]
  accessType: string
  priceMinor: number
  discountPriceMinor: number | null
  currency: string
  certificateEnabled: boolean
  courseFormat: string
  /** Added in learning round A; absent from older snapshots. */
  navigationMode?: string
  /** Added in learning round B; absent from older snapshots. */
  certificateDesign?: {
    template: string
    logoPath: string | null
    signaturePath: string | null
    signatoryName: string | null
    signatoryTitle: string | null
    serialPrefix: string | null
    validityMonths: number | null
    issueTrigger: string
  }
  /** Added in learning round C; absent from older snapshots. */
  pricingPlans?: Array<{ name: string; priceMinor: number; discountPriceMinor: number | null; currency: string; accessMonths: number | null }>
}

export type CourseSnapshotQuiz = {
  passPercentage: number
  instructions: string | null
  questions: Array<{ prompt: string; options: Array<{ label: string; isCorrect: boolean }> }>
}

export type CourseSnapshotAssignment = {
  instructions: string
  acceptedExtensions: string[]
  maxUploadBytes: number
  maxFiles: number
  maxPoints: number
  passingPercentage: number
}

export type CourseSnapshotMaterial = {
  id: string
  title: string
  materialType: string
  summary: string | null
  articleBody: string | null
  assetPath: string | null
  externalUrl: string | null
  isPublished: boolean
  releaseMode: string
  completionRule: string
  assignmentInstructions: string | null
  quiz: CourseSnapshotQuiz | null
  // Added in learning round A; absent from older snapshots, so only compared when both have them.
  articleFormat?: string
  durationSeconds?: number | null
  isPreview?: boolean
  isDownloadable?: boolean
  releaseAt?: string | null
  dripDelayDays?: number | null
  prerequisiteId?: string | null
  completionThreshold?: number | null
  maxAttempts?: number | null
  embedKind?: string | null
  captionPath?: string | null
  assignment?: CourseSnapshotAssignment | null
  scorm?: { sourceZipPath: string | null; launchPath: string | null } | null
  // Added in learning round B; absent from older snapshots.
  quizSettings?: CourseSnapshotQuizSettings | null
  quizQuestionDetails?: CourseSnapshotQuestionDetails[]
  certificateFinal?: boolean
}

export type CourseSnapshotQuizSettings = {
  timeLimitMinutes: number | null
  shuffleQuestions: boolean
  shuffleOptions: boolean
  drawCount: number | null
  answerPolicy: string
}

export type CourseSnapshotQuestionDetails = {
  type: string
  marks: number
  negativeMarks: number
  explanation: string | null
  acceptedAnswers: string[]
  caseSensitive: boolean
}

export type CourseSnapshotSection = {
  id: string
  title: string
  materials: CourseSnapshotMaterial[]
}

export type CourseReviewSnapshot = {
  version: 1
  details: CourseSnapshotDetails
  sections: CourseSnapshotSection[]
}

export type CourseReviewChange = {
  area: 'details' | 'section' | 'material'
  change: 'added' | 'removed' | 'changed' | 'moved'
  label: string
  fields: string[]
}

export type SnapshotCurriculumRow = {
  section_id: string
  section_title: string
  lesson_id: string | null
  lesson_title: string | null
  lesson_type: string | null
  lesson_summary?: string | null
  article_body: string | null
  asset_path: string | null
  external_url: string | null
  is_published: boolean | null
  release_mode: string | null
  completion_rule: string | null
  assignment_instructions: string | null
  quiz_id: string | null
  pass_percentage: string | number | null
  quiz_instructions?: string | null
  article_format?: string | null
  duration_seconds?: string | number | null
  is_preview?: boolean | null
  is_downloadable?: boolean | null
  release_at?: string | Date | null
  drip_delay_days?: string | number | null
  prerequisite_lesson_id?: string | null
  completion_threshold?: string | number | null
  max_attempts?: string | number | null
  embed_kind?: string | null
  caption_path?: string | null
  assignment_extensions?: string[] | null
  assignment_max_upload_bytes?: string | number | null
  assignment_max_files?: string | number | null
  assignment_max_points?: string | number | null
  assignment_passing_percentage?: string | number | null
  scorm_source_zip_path?: string | null
  scorm_launch_path?: string | null
  question_id: string | null
  question_prompt?: string | null
  option_id: string | null
  option_label?: string | null
  option_is_correct: boolean | null
  // Learning round B columns.
  time_limit_minutes?: string | number | null
  shuffle_questions?: boolean | null
  shuffle_options?: boolean | null
  draw_count?: string | number | null
  answer_policy?: string | null
  question_type?: string | null
  marks?: string | number | null
  negative_marks?: string | number | null
  explanation?: string | null
  accepted_answers?: string[] | null
  answers_case_sensitive?: boolean | null
  certificate_final?: boolean | null
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function nullableText(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
}

function numberOr(value: unknown, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

export function snapshotDetailsFromRow(row: Record<string, unknown>): CourseSnapshotDetails {
  return {
    slug: text(row.slug),
    title: text(row.title),
    subtitle: nullableText(row.subtitle),
    description: text(row.description),
    category: text(row.category),
    level: text(row.level),
    language: text(row.language),
    thumbnailPath: nullableText(row.thumbnail_path),
    trailerPath: nullableText(row.trailer_path),
    learningOutcomes: list(row.learning_outcomes),
    requirements: list(row.requirements),
    targetAudience: list(row.target_audience),
    accessType: text(row.access_type),
    priceMinor: numberOr(row.price_minor, 0),
    discountPriceMinor: row.discount_price_minor === null || row.discount_price_minor === undefined ? null : numberOr(row.discount_price_minor, 0),
    currency: text(row.currency),
    certificateEnabled: row.certificate_enabled === true,
    courseFormat: text(row.course_format),
    navigationMode: row.navigation_mode === 'sequential' ? 'sequential' : 'free',
    ...(row.certificate_template !== undefined
      ? {
          certificateDesign: {
            template: text(row.certificate_template) || 'classic',
            logoPath: nullableText(row.certificate_logo_path),
            signaturePath: nullableText(row.certificate_signature_path),
            signatoryName: nullableText(row.certificate_signatory_name),
            signatoryTitle: nullableText(row.certificate_signatory_title),
            serialPrefix: nullableText(row.certificate_serial_prefix),
            validityMonths: nullableNumber(row.certificate_validity_months),
            issueTrigger: text(row.certificate_issue_trigger) || 'course_completion',
          },
        }
      : {}),
    ...(row.pricing_plans !== undefined ? { pricingPlans: snapshotPlans(row.pricing_plans) } : {}),
  }
}

function snapshotPlans(value: unknown): NonNullable<CourseSnapshotDetails['pricingPlans']> {
  const list = typeof value === 'string' ? (JSON.parse(value) as unknown) : value
  if (!Array.isArray(list)) return []
  return list.map((entry) => {
    const plan = (entry ?? {}) as Record<string, unknown>
    return {
      name: text(plan.name),
      priceMinor: numberOr(plan.priceMinor, 0),
      discountPriceMinor: nullableNumber(plan.discountPriceMinor),
      currency: text(plan.currency),
      accessMonths: nullableNumber(plan.accessMonths),
    }
  })
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function nullableIso(value: unknown): string | null {
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? value : parsed.toISOString()
  }
  return null
}

/** Builds the curriculum part of a snapshot from the joined submission-readiness rows. */
export function snapshotSectionsFromRows(rows: SnapshotCurriculumRow[]): CourseSnapshotSection[] {
  const sections: CourseSnapshotSection[] = []
  const sectionById = new Map<string, CourseSnapshotSection>()
  const materialById = new Map<string, CourseSnapshotMaterial>()
  const questionById = new Map<string, CourseSnapshotQuiz['questions'][number]>()
  const seenOptions = new Set<string>()

  for (const row of rows) {
    let section = sectionById.get(row.section_id)
    if (!section) {
      section = { id: row.section_id, title: row.section_title, materials: [] }
      sectionById.set(row.section_id, section)
      sections.push(section)
    }
    if (!row.lesson_id || !row.lesson_title || !row.lesson_type) continue

    let material = materialById.get(row.lesson_id)
    if (!material) {
      material = {
        id: row.lesson_id,
        title: row.lesson_title,
        materialType: row.lesson_type,
        summary: row.lesson_summary ?? null,
        articleBody: row.article_body,
        assetPath: row.asset_path,
        externalUrl: row.external_url,
        isPublished: row.is_published === true,
        releaseMode: row.release_mode ?? 'immediate',
        completionRule: row.completion_rule ?? 'manual',
        assignmentInstructions: row.assignment_instructions,
        quiz: row.quiz_id && row.pass_percentage !== null
          ? { passPercentage: Number(row.pass_percentage), instructions: row.quiz_instructions ?? null, questions: [] }
          : null,
        articleFormat: row.article_format === 'html' ? 'html' : 'plain',
        durationSeconds: nullableNumber(row.duration_seconds),
        isPreview: row.is_preview === true,
        isDownloadable: row.is_downloadable === true,
        releaseAt: nullableIso(row.release_at),
        dripDelayDays: nullableNumber(row.drip_delay_days),
        prerequisiteId: row.prerequisite_lesson_id ?? null,
        completionThreshold: nullableNumber(row.completion_threshold),
        maxAttempts: nullableNumber(row.max_attempts),
        embedKind: row.embed_kind ?? null,
        captionPath: row.caption_path ?? null,
        assignment: row.assignment_instructions === null || row.assignment_instructions === undefined
          ? null
          : {
              instructions: row.assignment_instructions,
              acceptedExtensions: list(row.assignment_extensions),
              maxUploadBytes: numberOr(row.assignment_max_upload_bytes, 0),
              maxFiles: numberOr(row.assignment_max_files, 0),
              maxPoints: numberOr(row.assignment_max_points, 0),
              passingPercentage: numberOr(row.assignment_passing_percentage, 0),
            },
        scorm: row.scorm_source_zip_path
          ? { sourceZipPath: row.scorm_source_zip_path, launchPath: row.scorm_launch_path ?? null }
          : null,
        // Round B fields only when the rows carry them, so snapshots built before them compare as unchanged.
        ...(row.answer_policy !== undefined
          ? {
              quizSettings: row.quiz_id
                ? {
                    timeLimitMinutes: nullableNumber(row.time_limit_minutes),
                    shuffleQuestions: row.shuffle_questions === true,
                    shuffleOptions: row.shuffle_options === true,
                    drawCount: nullableNumber(row.draw_count),
                    answerPolicy: row.answer_policy ?? 'after_each_attempt',
                  }
                : null,
            }
          : {}),
        ...(row.question_type !== undefined ? { quizQuestionDetails: [] } : {}),
        ...(row.certificate_final !== undefined ? { certificateFinal: row.certificate_final === true } : {}),
      }
      materialById.set(row.lesson_id, material)
      section.materials.push(material)
    }

    if (!material.quiz || !row.question_id) continue
    let question = questionById.get(row.question_id)
    if (!question) {
      question = { prompt: row.question_prompt ?? '', options: [] }
      questionById.set(row.question_id, question)
      material.quiz.questions.push(question)
      material.quizQuestionDetails?.push({
        type: row.question_type ?? 'single_choice',
        marks: numberOr(row.marks, 1),
        negativeMarks: numberOr(row.negative_marks, 0),
        explanation: row.explanation ?? null,
        acceptedAnswers: list(row.accepted_answers),
        caseSensitive: row.answers_case_sensitive === true,
      })
    }
    if (row.option_id && !seenOptions.has(row.option_id)) {
      seenOptions.add(row.option_id)
      question.options.push({ label: row.option_label ?? '', isCorrect: row.option_is_correct === true })
    }
  }

  return sections
}

const DETAIL_LABELS: Array<[keyof CourseSnapshotDetails, string]> = [
  ['title', 'Title'],
  ['slug', 'URL slug'],
  ['subtitle', 'Subtitle'],
  ['description', 'Description'],
  ['category', 'Category'],
  ['level', 'Level'],
  ['language', 'Language'],
  ['courseFormat', 'Course format'],
  ['thumbnailPath', 'Thumbnail'],
  ['trailerPath', 'Trailer'],
  ['learningOutcomes', 'Learning outcomes'],
  ['requirements', 'Requirements'],
  ['targetAudience', 'Target audience'],
  ['accessType', 'Access type'],
  ['priceMinor', 'Price'],
  ['discountPriceMinor', 'Discount price'],
  ['currency', 'Currency'],
  ['certificateEnabled', 'Certificate'],
  ['navigationMode', 'Navigation (free or in order)'],
  ['certificateDesign', 'Certificate design, validity and issuing'],
  ['pricingPlans', 'Pricing plans and access periods'],
]

const MATERIAL_LABELS: Array<[keyof CourseSnapshotMaterial, string]> = [
  ['title', 'title'],
  ['materialType', 'type'],
  ['summary', 'summary'],
  ['articleBody', 'article content'],
  ['assetPath', 'uploaded file'],
  ['externalUrl', 'URL'],
  ['isPublished', 'visibility'],
  ['releaseMode', 'release'],
  ['completionRule', 'completion rule'],
  ['assignmentInstructions', 'assignment instructions'],
  ['quiz', 'quiz questions'],
  ['articleFormat', 'article formatting'],
  ['durationSeconds', 'duration'],
  ['isPreview', 'free preview'],
  ['isDownloadable', 'download setting'],
  ['releaseAt', 'release date'],
  ['dripDelayDays', 'drip delay'],
  ['prerequisiteId', 'prerequisite'],
  ['completionThreshold', 'completion threshold'],
  ['maxAttempts', 'attempt limit'],
  ['embedKind', 'embed provider'],
  ['captionPath', 'captions'],
  ['assignment', 'assignment settings'],
  ['scorm', 'SCORM package'],
  ['quizSettings', 'quiz settings (timer, shuffle, draw, answers shown)'],
  ['quizQuestionDetails', 'question types, marks and accepted answers'],
  ['certificateFinal', 'final quiz for the certificate'],
]

function same(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
}

/**
 * Fields added after a snapshot was stored are missing from it; comparing them would report a
 * change that never happened, so a field is compared only when both snapshots carry it.
 */
function changed<T extends object>(previous: T, current: T, key: keyof T) {
  if (!(key in previous) || !(key in current)) return false
  return !same(previous[key], current[key])
}

/** The assignment instructions are reported on their own; this compares the other settings. */
function assignmentSettings(value: CourseSnapshotAssignment | null | undefined) {
  if (!value) return value
  const { instructions: _instructions, ...settings } = value
  void _instructions
  return settings
}

export function isCourseReviewSnapshot(value: unknown): value is CourseReviewSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<CourseReviewSnapshot>
  return candidate.version === 1 && typeof candidate.details === 'object' && Array.isArray(candidate.sections)
}

/** Lists what changed between the previously reviewed submission and the current one. */
export function diffCourseSnapshots(previous: CourseReviewSnapshot, current: CourseReviewSnapshot): CourseReviewChange[] {
  const changes: CourseReviewChange[] = []

  const changedDetails = DETAIL_LABELS
    .filter(([key]) => changed(previous.details, current.details, key))
    .map(([, label]) => label)
  if (changedDetails.length) {
    changes.push({ area: 'details', change: 'changed', label: 'Course details', fields: changedDetails })
  }

  const previousSections = new Map(previous.sections.map((section, index) => [section.id, { section, index }]))
  const currentSectionIds = new Set(current.sections.map((section) => section.id))
  const previousMaterials = new Map(previous.sections.flatMap((section) =>
    section.materials.map((material, index) => [material.id, { material, sectionId: section.id, index }] as const)))
  const currentMaterialIds = new Set(current.sections.flatMap((section) => section.materials.map((material) => material.id)))

  current.sections.forEach((section, index) => {
    const before = previousSections.get(section.id)
    if (!before) {
      changes.push({ area: 'section', change: 'added', label: section.title, fields: [] })
    } else {
      const fields: string[] = []
      if (before.section.title !== section.title) fields.push(`renamed from “${before.section.title}”`)
      if (before.index !== index) fields.push('order')
      if (fields.length) changes.push({ area: 'section', change: fields.includes('order') && fields.length === 1 ? 'moved' : 'changed', label: section.title, fields })
    }

    section.materials.forEach((material, materialIndex) => {
      const beforeMaterial = previousMaterials.get(material.id)
      if (!beforeMaterial) {
        changes.push({ area: 'material', change: 'added', label: material.title, fields: [] })
        return
      }
      const fields = MATERIAL_LABELS
        .filter(([key]) => key === 'assignment'
          ? key in beforeMaterial.material && key in material
            && !same(assignmentSettings(beforeMaterial.material.assignment), assignmentSettings(material.assignment))
          : changed(beforeMaterial.material, material, key))
        .map(([, label]) => label)
      const moved = beforeMaterial.sectionId !== section.id || beforeMaterial.index !== materialIndex
      if (moved) fields.push(beforeMaterial.sectionId !== section.id ? 'moved to another section' : 'order')
      if (fields.length) {
        changes.push({ area: 'material', change: fields.length === 1 && moved ? 'moved' : 'changed', label: material.title, fields })
      }
    })
  })

  for (const section of previous.sections) {
    if (!currentSectionIds.has(section.id)) changes.push({ area: 'section', change: 'removed', label: section.title, fields: [] })
  }
  for (const [id, entry] of previousMaterials) {
    if (!currentMaterialIds.has(id)) changes.push({ area: 'material', change: 'removed', label: entry.material.title, fields: [] })
  }

  return changes
}

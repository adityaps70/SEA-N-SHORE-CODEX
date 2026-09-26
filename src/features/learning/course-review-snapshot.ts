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
}

export type CourseSnapshotQuiz = {
  passPercentage: number
  instructions: string | null
  questions: Array<{ prompt: string; options: Array<{ label: string; isCorrect: boolean }> }>
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
  question_id: string | null
  question_prompt?: string | null
  option_id: string | null
  option_label?: string | null
  option_is_correct: boolean | null
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
  }
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
]

function same(left: unknown, right: unknown) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null)
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
    .filter(([key]) => !same(previous.details[key], current.details[key]))
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
        .filter(([key]) => !same(beforeMaterial.material[key], material[key]))
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

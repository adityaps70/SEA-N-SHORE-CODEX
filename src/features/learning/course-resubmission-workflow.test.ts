import { describe, expect, it } from 'vitest'
import { createLearningAdminRepository } from './admin-repository'
import { createCourseRepository, type CourseDraftInput } from './course-repository'
import { createMentorMaterialRepository, type MentorMaterialDraft } from './mentor-material-repository'

/**
 * End-to-end course review lifecycle against an in-memory stand-in for the
 * Aurora tables the repositories touch:
 * Edit → Save → Submit → Request changes → Edit → Save → Resubmit → Approve,
 * asserting the stored content (and what the reviewer sees) at every step.
 */

const trainerUserId = '11111111-1111-4111-8111-111111111111'
const mentorId = '22222222-2222-4222-8222-222222222222'
const courseId = '33333333-3333-4333-8333-333333333333'
const sectionId = '44444444-4444-4444-8444-444444444444'
const lessonId = '55555555-5555-4555-8555-555555555555'
const adminUserId = '66666666-6666-4666-8666-666666666666'
const strangerUserId = '77777777-7777-4777-8777-777777777777'

type Values = readonly unknown[] | undefined

type Lesson = {
  id: string
  title: string
  lesson_type: string
  position: number
  summary: string | null
  article_body: string | null
  is_published: boolean
}

type Submission = {
  id: string
  course_id: string
  submitted_by: string
  submitted_at: string
  details_revision: number
  snapshot: unknown
  outcome: string
  reviewer_id: string | null
  reviewer_note: string | null
  reviewed_at: string | null
}

function createFakeDatabase() {
  let tick = 0
  const now = () => new Date(Date.UTC(2026, 8, 27, 9, tick++)).toISOString()

  const course = {
    id: courseId,
    mentor_id: mentorId,
    company_id: null as string | null,
    created_by_user_id: trainerUserId,
    status: 'draft',
    details_revision: 1,
    slug: 'sire-2-readiness',
    title: 'SIRE 2.0 Readiness',
    subtitle: null as string | null,
    description: 'A practical course that prepares tanker officers for SIRE 2.0 inspections on board.',
    category: 'SIRE 2.0',
    level: 'advanced',
    language: 'English',
    thumbnail_path: null as string | null,
    trailer_path: null as string | null,
    learning_outcomes: ['Explain SIRE 2.0 expectations'],
    requirements: ['Tanker experience'],
    target_audience: ['Deck officers'],
    price_minor: 0,
    discount_price_minor: null as number | null,
    currency: 'INR',
    access_type: 'free',
    certificate_enabled: true,
    course_format: 'recorded',
    navigation_mode: 'free',
    admin_review_note: null as string | null,
    reviewed_by: null as string | null,
    reviewed_at: null as string | null,
    approved_at: null as string | null,
    published_at: null as string | null,
    updated_at: now(),
  }
  const section = { id: sectionId, title: 'Module 1 · Inspection foundations', position: 0 }
  const lessons: Lesson[] = [{
    id: lessonId,
    title: 'Inspection evidence',
    lesson_type: 'article',
    position: 0,
    summary: null,
    article_body: 'Review records and procedures before the inspection.',
    is_published: true,
  }]
  const submissions: Submission[] = []
  const audit: Array<{ action: unknown }> = []

  function canManage(actorId: unknown) {
    return actorId === trainerUserId
  }

  function readinessRows() {
    return lessons.map((lesson) => ({
      section_id: section.id,
      section_title: section.title,
      section_position: section.position,
      lesson_id: lesson.id,
      lesson_title: lesson.title,
      lesson_type: lesson.lesson_type,
      lesson_position: lesson.position,
      lesson_summary: lesson.summary,
      article_body: lesson.article_body,
      asset_path: null,
      external_url: null,
      is_published: lesson.is_published,
      release_mode: 'immediate',
      release_at: null,
      drip_delay_days: null,
      prerequisite_lesson_id: null,
      completion_rule: 'manual',
      completion_threshold: null,
      max_attempts: null,
      embed_kind: null,
      assignment_instructions: null,
      assignment_extensions: null,
      assignment_max_upload_bytes: null,
      scorm_status: null,
      scorm_source_zip_path: null,
      scorm_launch_path: null,
      scorm_processing_error: null,
      quiz_id: null,
      pass_percentage: null,
      quiz_instructions: null,
      question_id: null,
      question_prompt: null,
      question_position: null,
      option_id: null,
      option_label: null,
      option_position: null,
      option_is_correct: null,
      course_id: course.id,
      duration_seconds: null,
      is_preview: false,
      is_downloadable: false,
    }))
  }

  function latest(outcomes: string[]) {
    return [...submissions]
      .filter((submission) => outcomes.includes(submission.outcome))
      .sort((left, right) => (right.reviewed_at ?? right.submitted_at).localeCompare(left.reviewed_at ?? left.submitted_at))[0]
  }

  async function query(text: string, values: Values = []) {
    const v = values ?? []

    if (text.includes('from public.user_roles')) return v[0] === adminUserId ? [{ allowed: true }] : []

    // Course manager locks (details, submit, withdraw, curriculum): ownership enforced via the access SQL.
    if (text.includes('from public.learning_courses course') && text.includes('for update')) {
      if (!text.includes('access_mentor')) throw new Error('lock without manager access check')
      return v[0] === course.id && canManage(v[1]) ? [{ ...course }] : []
    }
    // Administrator review lock.
    if (text.includes('from public.learning_courses') && text.includes('for update')) {
      return v[0] === course.id ? [{ id: course.id, mentor_id: course.mentor_id, status: course.status }] : []
    }

    if (text.includes('update public.learning_courses') && text.includes('set slug = $2')) {
      if (v[0] !== course.id) return []
      const keys = [
        'slug', 'title', 'subtitle', 'description', 'category', 'level', 'language', 'thumbnail_path',
        'trailer_path', 'learning_outcomes', 'requirements', 'target_audience', 'price_minor',
        'discount_price_minor', 'currency', 'access_type', 'certificate_enabled', 'course_format',
      ] as const
      keys.forEach((key, index) => {
        Object.assign(course, { [key]: v[index + 1] })
      })
      course.details_revision += 1
      course.updated_at = now()
      return [{ id: course.id, details_revision: course.details_revision, updated_at: course.updated_at }]
    }
    if (text.includes("set status = 'submitted'")) {
      Object.assign(course, { status: 'submitted', reviewed_by: null, reviewed_at: null, admin_review_note: null, approved_at: null, updated_at: now() })
      return [{ id: course.id }]
    }
    if (text.includes("set status = 'draft'")) {
      if (course.status !== 'submitted') return []
      Object.assign(course, { status: 'draft', updated_at: now() })
      return [{ id: course.id }]
    }
    if (text.includes('update public.learning_courses') && text.includes('reviewed_by = $3')) {
      const at = now()
      Object.assign(course, { status: v[1], reviewed_by: v[2], reviewed_at: at, admin_review_note: v[3], updated_at: at })
      if (text.includes('published_at = now()')) course.published_at = at
      return [{ id: course.id }]
    }

    if (text.includes('update public.learning_course_submissions') && text.includes("set outcome = 'withdrawn'")) {
      for (const submission of submissions) if (submission.outcome === 'pending') submission.outcome = 'withdrawn'
      return []
    }
    if (text.includes('update public.learning_course_submissions') && text.includes('set outcome = $2')) {
      const at = now()
      for (const submission of submissions) {
        if (submission.outcome !== 'pending') continue
        Object.assign(submission, { outcome: v[1], reviewer_id: v[2], reviewer_note: v[3], reviewed_at: at })
      }
      return []
    }
    if (text.includes('insert into public.learning_course_submissions')) {
      if (submissions.some((submission) => submission.outcome === 'pending')) throw Object.assign(new Error('duplicate pending'), { code: '23505' })
      submissions.push({
        id: `submission-${submissions.length + 1}`,
        course_id: String(v[0]),
        submitted_by: String(v[1]),
        submitted_at: now(),
        details_revision: Number(v[2]),
        snapshot: JSON.parse(String(v[3])),
        outcome: 'pending',
        reviewer_id: null,
        reviewer_note: null,
        reviewed_at: null,
      })
      return []
    }
    if (text.includes('insert into public.audit_events')) {
      audit.push({ action: v[1] })
      return []
    }

    // Curriculum material save (mentor material repository).
    if (text.includes('update public.learning_lessons as lesson')) {
      const lesson = lessons.find((entry) => entry.id === v[0])
      if (!lesson || v[1] !== course.id) return []
      Object.assign(lesson, { title: v[2], lesson_type: v[3], summary: v[4], article_body: v[5], is_published: v[11] })
      return [{ id: lesson.id }]
    }
    if (text.trimStart().startsWith('delete from') || text.includes('insert into public.learning_assignments')) return []

    // Submission readiness + snapshot rows, and the admin curriculum evidence.
    if (text.includes('from public.learning_course_sections section')) return readinessRows()

    if (text.includes('from public.learning_course_submissions submission') && text.includes('row_number()')) {
      return [...submissions].sort((left, right) => right.submitted_at.localeCompare(left.submitted_at))
    }

    // Admin review queue.
    if (text.includes('from public.learning_courses course') && text.includes('where course.status = $1')) {
      if (course.status !== v[0]) return []
      return [{
        ...course,
        course_id: course.id,
        mentor_user_id: trainerUserId,
        mentor_name: 'Capt. Asha Menon',
      }]
    }

    // Trainer's editable course detail.
    if (text.includes('left join lateral') && text.includes('course.id = $2')) {
      if (v[1] !== course.id || !canManage(v[0])) return []
      const lastReview = latest(['changes_requested', 'approved'])
      const pending = latest(['pending'])
      return [{
        ...course,
        publisher_name: 'Capt. Asha Menon',
        publisher_slug: 'capt-asha-menon',
        last_review_outcome: lastReview?.outcome ?? null,
        last_review_note: lastReview?.reviewer_note ?? null,
        last_review_at: lastReview?.reviewed_at ?? null,
        pending_submitted_at: pending?.submitted_at ?? null,
      }]
    }

    throw new Error(`Unhandled query in fake database:\n${text}`)
  }

  const transaction = async <T,>(work: (tx: typeof query) => Promise<T>) => work(query)

  return {
    course,
    lessons,
    submissions,
    audit,
    courses: createCourseRepository({ query, transaction }),
    materials: createMentorMaterialRepository({ query, transaction }),
    admin: createLearningAdminRepository({ query, transaction }),
  }
}

function detailsInput(db: ReturnType<typeof createFakeDatabase>, overrides: Partial<CourseDraftInput> = {}): CourseDraftInput {
  const { course } = db
  return {
    slug: course.slug,
    title: course.title,
    subtitle: course.subtitle,
    description: course.description,
    category: course.category,
    level: course.level as CourseDraftInput['level'],
    language: course.language,
    thumbnailPath: course.thumbnail_path,
    trailerPath: course.trailer_path,
    learningOutcomes: [...course.learning_outcomes],
    requirements: [...course.requirements],
    targetAudience: [...course.target_audience],
    accessType: course.access_type as CourseDraftInput['accessType'],
    priceMinor: course.price_minor,
    discountPriceMinor: course.discount_price_minor,
    currency: course.currency,
    certificateEnabled: course.certificate_enabled,
    courseFormat: course.course_format as CourseDraftInput['courseFormat'],
    ...overrides,
  }
}

function articleDraft(overrides: Partial<MentorMaterialDraft> = {}): MentorMaterialDraft {
  return {
    title: 'Inspection evidence',
    materialType: 'article',
    summary: null,
    articleBody: 'Review records and procedures before the inspection.',
    assetPath: null,
    externalUrl: null,
    durationSeconds: null,
    isPreview: false,
    isDownloadable: false,
    isPublished: true,
    releaseMode: 'immediate',
    releaseAt: null,
    dripDelayDays: null,
    prerequisiteLessonId: null,
    completionRule: 'manual',
    completionThreshold: null,
    maxAttempts: null,
    embedKind: null,
    assignment: null,
    ...overrides,
  }
}

describe('course review lifecycle: edit, submit, request changes, resubmit, approve', () => {
  it('keeps every saved edit through the full review cycle and shows the reviewer what changed', async () => {
    const db = createFakeDatabase()

    // 1. Edit → Save (draft).
    const firstSave = await db.courses.updateCourse(trainerUserId, courseId, detailsInput(db, {
      title: 'SIRE 2.0 Readiness for Tanker Officers',
      learningOutcomes: ['Explain SIRE 2.0 expectations', 'Prepare onboard evidence'],
    }), { expectedRevision: 1 })
    expect(firstSave.revision).toBe(2)
    let owned = await db.courses.getOwnedCourse(trainerUserId, courseId)
    expect(owned).toMatchObject({
      status: 'draft',
      title: 'SIRE 2.0 Readiness for Tanker Officers',
      learningOutcomes: ['Explain SIRE 2.0 expectations', 'Prepare onboard evidence'],
      detailsRevision: 2,
      lastReview: null,
    })

    // 2. Submit (with the revision just saved).
    await expect(db.courses.submitCourse(trainerUserId, courseId, { expectedRevision: firstSave.revision })).resolves.toBe(true)
    owned = await db.courses.getOwnedCourse(trainerUserId, courseId)
    expect(owned?.status).toBe('submitted')
    expect(owned?.submittedAt).toEqual(expect.any(String))
    expect(db.submissions).toHaveLength(1)
    expect(db.submissions[0]).toMatchObject({ outcome: 'pending', details_revision: 2 })
    expect(db.submissions[0]?.snapshot).toMatchObject({
      version: 1,
      details: { title: 'SIRE 2.0 Readiness for Tanker Officers' },
      sections: [{ id: sectionId, materials: [{ id: lessonId, articleBody: 'Review records and procedures before the inspection.' }] }],
    })

    // Locked while in review: details and curriculum saves are refused, nothing changes.
    await expect(db.courses.updateCourse(trainerUserId, courseId, detailsInput(db, { title: 'Sneaky in-review edit' }), { expectedRevision: 2 }))
      .rejects.toMatchObject({ message: 'course_edit_forbidden', status: 'submitted' })
    await expect(db.materials.updateMaterial(trainerUserId, courseId, lessonId, articleDraft({ articleBody: 'Sneaky lesson edit' })))
      .rejects.toThrow('course_edit_forbidden')
    expect(db.course.title).toBe('SIRE 2.0 Readiness for Tanker Officers')
    expect(db.lessons[0]?.article_body).toBe('Review records and procedures before the inspection.')

    // First review: the reviewer sees the submitted content, with no earlier review to compare.
    let queue = await db.admin.listCoursesForReview(adminUserId, 'submitted')
    expect(queue).toHaveLength(1)
    expect(queue[0]).toMatchObject({
      title: 'SIRE 2.0 Readiness for Tanker Officers',
      review: { submissionNumber: 1, previousReview: null, changesSinceLastReview: null },
    })

    // 3. Reviewer requests changes.
    const note = 'Make the evidence outcome specific and expand the lesson with a document checklist.'
    await expect(db.admin.reviewCourse(adminUserId, courseId, 'changes_requested', note))
      .resolves.toEqual({ courseId, status: 'changes_requested' })
    expect(db.submissions[0]).toMatchObject({ outcome: 'changes_requested', reviewer_note: note, reviewer_id: adminUserId })

    // Trainer sees the note on the edit page and can edit again.
    owned = await db.courses.getOwnedCourse(trainerUserId, courseId)
    expect(owned).toMatchObject({
      status: 'changes_requested',
      adminReviewNote: note,
      lastReview: { decision: 'changes_requested', note },
      title: 'SIRE 2.0 Readiness for Tanker Officers',
    })

    // A save from a stale form (revision 1) is refused instead of overwriting.
    await expect(db.courses.updateCourse(trainerUserId, courseId, detailsInput(db, { title: 'Stale tab title' }), { expectedRevision: 1 }))
      .rejects.toMatchObject({ message: 'course_edit_conflict', currentRevision: 2 })
    expect(db.course.title).toBe('SIRE 2.0 Readiness for Tanker Officers')

    // 4. Edit → Save again (details and the lesson).
    const secondSave = await db.courses.updateCourse(trainerUserId, courseId, detailsInput(db, {
      learningOutcomes: ['Explain SIRE 2.0 expectations', 'Prepare a complete onboard evidence pack'],
      subtitle: 'Evidence-led inspection preparation',
    }), { expectedRevision: owned!.detailsRevision })
    expect(secondSave.revision).toBe(3)
    await expect(db.materials.updateMaterial(trainerUserId, courseId, lessonId, articleDraft({
      articleBody: 'Review records and procedures before the inspection. Checklist: certificates, SMS records, crew familiarisation logs.',
    }))).resolves.toBe(true)
    owned = await db.courses.getOwnedCourse(trainerUserId, courseId)
    expect(owned).toMatchObject({
      status: 'changes_requested',
      subtitle: 'Evidence-led inspection preparation',
      learningOutcomes: ['Explain SIRE 2.0 expectations', 'Prepare a complete onboard evidence pack'],
      detailsRevision: 3,
    })
    expect(db.lessons[0]?.article_body).toContain('Checklist: certificates')

    // Submitting with an older revision than stored is refused (no stale submission).
    await expect(db.courses.submitCourse(trainerUserId, courseId, { expectedRevision: 2 }))
      .rejects.toMatchObject({ message: 'course_edit_conflict' })
    expect(db.course.status).toBe('changes_requested')

    // 5. Resubmit.
    await expect(db.courses.submitCourse(trainerUserId, courseId, { expectedRevision: secondSave.revision })).resolves.toBe(true)
    expect(db.course.status).toBe('submitted')
    expect(db.submissions.map((submission) => submission.outcome)).toEqual(['changes_requested', 'pending'])

    // Trainer keeps the reviewer's note while the resubmission is in review.
    owned = await db.courses.getOwnedCourse(trainerUserId, courseId)
    expect(owned).toMatchObject({ status: 'submitted', adminReviewNote: null, lastReview: { decision: 'changes_requested', note } })

    // The reviewer sees the new content, their previous note, and exactly what changed.
    queue = await db.admin.listCoursesForReview(adminUserId, 'submitted')
    expect(queue[0]).toMatchObject({
      subtitle: 'Evidence-led inspection preparation',
      learningOutcomes: ['Explain SIRE 2.0 expectations', 'Prepare a complete onboard evidence pack'],
      curriculum: [{ lessons: [{ articleBody: expect.stringContaining('Checklist: certificates') }] }],
      review: {
        submissionNumber: 2,
        previousReview: { decision: 'changes_requested', note },
        changesSinceLastReview: [
          { area: 'details', change: 'changed', label: 'Course details', fields: ['Subtitle', 'Learning outcomes'] },
          { area: 'material', change: 'changed', label: 'Inspection evidence', fields: ['article content'] },
        ],
      },
    })

    // 6. Approve: published with the resubmitted content.
    await expect(db.admin.reviewCourse(adminUserId, courseId, 'approved', null))
      .resolves.toEqual({ courseId, status: 'published' })
    expect(db.course).toMatchObject({
      status: 'published',
      subtitle: 'Evidence-led inspection preparation',
      learning_outcomes: ['Explain SIRE 2.0 expectations', 'Prepare a complete onboard evidence pack'],
    })
    expect(db.lessons[0]?.article_body).toContain('Checklist: certificates')
    expect(db.submissions.map((submission) => submission.outcome)).toEqual(['changes_requested', 'approved'])
    expect(db.audit.map((entry) => entry.action)).toEqual(['learning.course.changes_requested', 'learning.course.approved'])

    // Published courses are read-only in Studio: the live copy stays as approved.
    await expect(db.courses.updateCourse(trainerUserId, courseId, detailsInput(db, { title: 'Edit after publishing' }), { expectedRevision: 3 }))
      .rejects.toMatchObject({ message: 'course_edit_forbidden', status: 'published' })
    expect(db.course.title).toBe('SIRE 2.0 Readiness for Tanker Officers')
  })

  it('lets the trainer withdraw an in-review course, edit it and resubmit without losing anything', async () => {
    const db = createFakeDatabase()
    await db.courses.submitCourse(trainerUserId, courseId, { expectedRevision: 1 })
    expect(db.course.status).toBe('submitted')

    await expect(db.courses.withdrawCourse(trainerUserId, courseId)).resolves.toBe(true)
    expect(db.course.status).toBe('draft')
    expect(db.course.title).toBe('SIRE 2.0 Readiness')
    expect(db.submissions[0]?.outcome).toBe('withdrawn')

    // The reviewer who still had it open gets a clear refusal, not a silent state change.
    await expect(db.admin.reviewCourse(adminUserId, courseId, 'approved', null)).rejects.toThrow('course_withdrawn')
    expect(db.course.status).toBe('draft')

    const saved = await db.courses.updateCourse(trainerUserId, courseId, detailsInput(db, { title: 'SIRE 2.0 Readiness — revised' }), { expectedRevision: 1 })
    await db.courses.submitCourse(trainerUserId, courseId, { expectedRevision: saved.revision })
    expect(db.course).toMatchObject({ status: 'submitted', title: 'SIRE 2.0 Readiness — revised' })
    expect(db.submissions.map((submission) => submission.outcome)).toEqual(['withdrawn', 'pending'])

    const queue = await db.admin.listCoursesForReview(adminUserId, 'submitted')
    expect(queue[0]).toMatchObject({ title: 'SIRE 2.0 Readiness — revised', review: { submissionNumber: 1, previousReview: null } })
  })

  it('refuses withdrawal when the course is not in review, and hides the course from other users', async () => {
    const db = createFakeDatabase()
    await expect(db.courses.withdrawCourse(trainerUserId, courseId)).rejects.toThrow('course_withdraw_forbidden')
    await expect(db.courses.withdrawCourse(strangerUserId, courseId)).rejects.toThrow('course_not_found')
    await expect(db.courses.updateCourse(strangerUserId, courseId, detailsInput(db, { title: 'Hijacked title' })))
      .rejects.toThrow('course_not_found')
    await expect(db.courses.getOwnedCourse(strangerUserId, courseId)).resolves.toBeNull()
    expect(db.course.title).toBe('SIRE 2.0 Readiness')
  })
})

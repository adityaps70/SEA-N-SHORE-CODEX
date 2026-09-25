import { describe, expect, it } from 'vitest'
import { createCourseRepository } from './course-repository'

const mentorUserId = '11111111-1111-4111-8111-111111111111'
const mentorId = '22222222-2222-4222-8222-222222222222'
const courseId = '33333333-3333-4333-8333-333333333333'
const sectionId = '44444444-4444-4444-8444-444444444444'
const lessonId = '55555555-5555-4555-8555-555555555555'

const detailRow = {
  id: courseId,
  slug: 'sire-2-readiness-for-tanker-officers',
  title: 'SIRE 2.0 Readiness for Tanker Officers',
  subtitle: 'Practical preparation for inspections and onboard competency',
  description: 'A practical maritime course that helps tanker officers understand SIRE 2.0 expectations, prepare evidence and improve onboard competency before an inspection.',
  category: 'SIRE 2.0',
  level: 'advanced',
  language: 'English',
  thumbnail_path: null,
  trailer_path: null,
  learning_outcomes: ['Understand SIRE 2.0 expectations', 'Prepare practical onboard evidence'],
  requirements: ['Active or recent tanker experience'],
  target_audience: ['Deck Officers', 'Marine Superintendents'],
  price_minor: '0',
  discount_price_minor: null,
  currency: 'INR',
  access_type: 'free',
  certificate_enabled: true,
  course_format: 'recorded',
  status: 'changes_requested',
  admin_review_note: 'Please make the inspection evidence outcome more specific.',
  updated_at: new Date('2026-09-14T12:00:00.000Z'),
  company_id: null,
  publisher_name: 'Capt. Mentor',
  publisher_slug: 'capt-mentor',
}

const validSubmissionCurriculumRow = {
  section_id: sectionId,
  section_title: 'Module 1 · Inspection foundations',
  section_position: 0,
  lesson_id: lessonId,
  lesson_title: 'Inspection evidence and crew readiness',
  lesson_type: 'article',
  lesson_position: 0,
  article_body: 'Review records, procedures and crew readiness before the inspection.',
  asset_path: null,
  external_url: null,
  is_published: true,
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
  question_id: null,
  question_position: null,
  option_id: null,
  option_is_correct: null,
}

function isSubmissionReadinessQuery(text: string) {
  return text.includes('learning_course_sections section') && text.includes('learning_lessons lesson')
}

describe('learning course lifecycle repository', () => {
  it('loads full editable course details only through active mentor ownership', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createCourseRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [detailRow]
      },
    })

    await expect(repository.getOwnedCourse(mentorUserId, courseId)).resolves.toEqual({
      id: courseId,
      slug: 'sire-2-readiness-for-tanker-officers',
      title: 'SIRE 2.0 Readiness for Tanker Officers',
      subtitle: 'Practical preparation for inspections and onboard competency',
      description: detailRow.description,
      category: 'SIRE 2.0',
      level: 'advanced',
      language: 'English',
      thumbnailPath: null,
      trailerPath: null,
      learningOutcomes: ['Understand SIRE 2.0 expectations', 'Prepare practical onboard evidence'],
      requirements: ['Active or recent tanker experience'],
      targetAudience: ['Deck Officers', 'Marine Superintendents'],
      priceMinor: 0,
      discountPriceMinor: null,
      currency: 'INR',
      accessType: 'free',
      certificateEnabled: true,
      courseFormat: 'recorded',
      status: 'changes_requested',
      adminReviewNote: 'Please make the inspection evidence outcome more specific.',
      updatedAt: '2026-09-14T12:00:00.000Z',
      publisherType: 'personal',
      companyId: null,
      publisherName: 'Capt. Mentor',
      publisherSlug: 'capt-mentor',
    })

    expect(seen[0]?.text).toContain('public.learning_mentors access_mentor')
    expect(seen[0]?.text).toContain('access_mentor.user_id = $1')
    expect(seen[0]?.text).toContain("access_mentor.status = 'active'")
    expect(seen[0]?.text).toContain('course.id = $2')
    expect(seen[0]?.values).toEqual([mentorUserId, courseId])
  })

  it('returns null when the active mentor does not own the course', async () => {
    const repository = createCourseRepository({ query: async () => [] })
    await expect(repository.getOwnedCourse(mentorUserId, courseId)).resolves.toBeNull()
  })

  it('submits an owned draft course with valid curriculum for admin review atomically', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    let transactionCount = 0
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('for update')) return [{ id: courseId, status: 'draft', mentor_id: mentorId, company_id: null }]
      if (isSubmissionReadinessQuery(text)) return [validSubmissionCurriculumRow]
      if (text.includes('update public.learning_courses')) return [{ id: courseId }]
      return []
    }
    const repository = createCourseRepository({
      query,
      transaction: async (work) => {
        transactionCount += 1
        return work(query)
      },
    })

    await expect(repository.submitCourse(mentorUserId, courseId)).resolves.toBe(true)

    expect(transactionCount).toBe(1)
    const lock = seen.find((entry) => entry.text.includes('for update'))
    expect(lock?.text).toContain('public.learning_mentors access_mentor')
    expect(lock?.text).toContain('access_mentor.user_id = $2')
    expect(lock?.text).toContain("access_mentor.status = 'active'")
    expect(lock?.values).toEqual([courseId, mentorUserId])

    const readiness = seen.find((entry) => isSubmissionReadinessQuery(entry.text))
    expect(readiness?.values).toEqual([courseId])

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.text).toContain("status = 'submitted'")
    expect(update?.text).toContain('reviewed_by = null')
    expect(update?.text).toContain('reviewed_at = null')
    expect(update?.text).toContain('admin_review_note = null')
    expect(update?.values).toEqual([courseId])
  })

  it('allows resubmission after an administrator requests changes when curriculum is valid', async () => {
    const query = async (text: string) => {
      if (text.includes('for update')) return [{ id: courseId, status: 'changes_requested', mentor_id: mentorId, company_id: null }]
      if (isSubmissionReadinessQuery(text)) return [validSubmissionCurriculumRow]
      if (text.includes('update public.learning_courses')) return [{ id: courseId }]
      return []
    }
    const repository = createCourseRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.submitCourse(mentorUserId, courseId)).resolves.toBe(true)
  })

  it('rejects mentor submission from a non-submittable state without updating the course', async () => {
    const seen: string[] = []
    const query = async (text: string) => {
      seen.push(text)
      if (text.includes('for update')) return [{ id: courseId, status: 'approved', mentor_id: mentorId, company_id: null }]
      return []
    }
    const repository = createCourseRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.submitCourse(mentorUserId, courseId)).rejects.toThrow('course_submit_forbidden')
    expect(seen.some((text) => text.includes('update public.learning_courses'))).toBe(false)
    expect(seen.some((text) => isSubmissionReadinessQuery(text))).toBe(false)
  })
})

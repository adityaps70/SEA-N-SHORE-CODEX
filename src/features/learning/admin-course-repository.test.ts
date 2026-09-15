import { describe, expect, it } from 'vitest'
import { createLearningAdminRepository } from './admin-repository'

const administratorId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const courseId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const mentorId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const mentorUserId = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd'

function courseRow() {
  return {
    course_id: courseId,
    mentor_id: mentorId,
    mentor_user_id: mentorUserId,
    mentor_name: 'Capt. Asha Menon',
    slug: 'sire-2-readiness',
    title: 'SIRE 2.0 Readiness',
    subtitle: 'Practical tanker inspection preparation',
    description: 'A detailed practical course for tanker officers preparing for SIRE 2.0 inspections and competency conversations.',
    category: 'SIRE 2.0',
    level: 'advanced',
    language: 'English',
    learning_outcomes: ['Explain SIRE 2.0 expectations', 'Prepare onboard evidence'],
    requirements: ['Tanker experience'],
    target_audience: ['Deck officers'],
    price_minor: '0',
    discount_price_minor: null,
    currency: 'INR',
    access_type: 'free',
    certificate_enabled: true,
    course_format: 'recorded',
    status: 'submitted',
    admin_review_note: null,
    updated_at: new Date('2026-09-14T12:00:00.000Z'),
  }
}

describe('learning admin course review repository', () => {
  it('fails closed before listing submitted courses for a non-administrator', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return []
      return []
    }
    const repository = createLearningAdminRepository({ query })

    await expect(repository.listCoursesForReview(administratorId, 'submitted')).rejects.toThrow('admin_forbidden')
    expect(seen.some((entry) => entry.text.includes('from public.learning_courses'))).toBe(false)
  })

  it('lists course review items with mentor identity and maritime course metadata oldest-first', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_courses course')) return [courseRow()]
      return []
    }
    const repository = createLearningAdminRepository({ query })

    await expect(repository.listCoursesForReview(administratorId, 'submitted')).resolves.toEqual([{
      courseId,
      mentorId,
      mentorUserId,
      mentorName: 'Capt. Asha Menon',
      slug: 'sire-2-readiness',
      title: 'SIRE 2.0 Readiness',
      subtitle: 'Practical tanker inspection preparation',
      description: 'A detailed practical course for tanker officers preparing for SIRE 2.0 inspections and competency conversations.',
      category: 'SIRE 2.0',
      level: 'advanced',
      language: 'English',
      learningOutcomes: ['Explain SIRE 2.0 expectations', 'Prepare onboard evidence'],
      requirements: ['Tanker experience'],
      targetAudience: ['Deck officers'],
      priceMinor: 0,
      discountPriceMinor: null,
      currency: 'INR',
      accessType: 'free',
      certificateEnabled: true,
      courseFormat: 'recorded',
      status: 'submitted',
      adminReviewNote: null,
      updatedAt: '2026-09-14T12:00:00.000Z',
      curriculum: [],
    }])

    const listQuery = seen.find((entry) => entry.text.includes('from public.learning_courses course'))
    expect(listQuery?.values).toEqual(['submitted'])
    expect(listQuery?.text).toContain('order by course.updated_at asc, course.id asc')
    expect(listQuery?.text).toContain('learning_mentor_applications')
  })

  it('loads frozen curriculum and the quiz answer key only into the administrator review model', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_courses course')) return [courseRow()]
      if (text.includes('from public.learning_course_sections section')) {
        return [
          {
            course_id: courseId,
            section_id: '11111111-1111-4111-8111-111111111111',
            section_title: 'Module 1 · Inspection readiness',
            section_position: 0,
            lesson_id: '22222222-2222-4222-8222-222222222222',
            lesson_title: 'Evidence preparation',
            lesson_type: 'article',
            lesson_position: 0,
            lesson_summary: 'Prepare evidence before the inspection.',
            article_body: 'Review records, procedures and interview evidence.',
            asset_path: null,
            external_url: null,
            duration_seconds: 300,
            is_preview: false,
            is_downloadable: false,
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
          },
          {
            course_id: courseId,
            section_id: '11111111-1111-4111-8111-111111111111',
            section_title: 'Module 1 · Inspection readiness',
            section_position: 0,
            lesson_id: '33333333-3333-4333-8333-333333333333',
            lesson_title: 'SIRE knowledge check',
            lesson_type: 'quiz',
            lesson_position: 1,
            lesson_summary: 'Check core knowledge.',
            article_body: null,
            asset_path: null,
            external_url: null,
            duration_seconds: null,
            is_preview: false,
            is_downloadable: false,
            quiz_id: '44444444-4444-4444-8444-444444444444',
            pass_percentage: 80,
            quiz_instructions: 'Choose the best answer.',
            question_id: '55555555-5555-4555-8555-555555555555',
            question_prompt: 'What should be prepared before inspection?',
            question_position: 0,
            option_id: '66666666-6666-4666-8666-666666666666',
            option_label: 'Only certificates',
            option_position: 0,
            option_is_correct: false,
          },
          {
            course_id: courseId,
            section_id: '11111111-1111-4111-8111-111111111111',
            section_title: 'Module 1 · Inspection readiness',
            section_position: 0,
            lesson_id: '33333333-3333-4333-8333-333333333333',
            lesson_title: 'SIRE knowledge check',
            lesson_type: 'quiz',
            lesson_position: 1,
            lesson_summary: 'Check core knowledge.',
            article_body: null,
            asset_path: null,
            external_url: null,
            duration_seconds: null,
            is_preview: false,
            is_downloadable: false,
            quiz_id: '44444444-4444-4444-8444-444444444444',
            pass_percentage: 80,
            quiz_instructions: 'Choose the best answer.',
            question_id: '55555555-5555-4555-8555-555555555555',
            question_prompt: 'What should be prepared before inspection?',
            question_position: 0,
            option_id: '77777777-7777-4777-8777-777777777777',
            option_label: 'Evidence, procedures and crew readiness',
            option_position: 1,
            option_is_correct: true,
          },
        ]
      }
      return []
    }
    const repository = createLearningAdminRepository({ query })

    const [course] = await repository.listCoursesForReview(administratorId, 'submitted')
    expect(course.curriculum).toEqual([{
      id: '11111111-1111-4111-8111-111111111111',
      title: 'Module 1 · Inspection readiness',
      position: 0,
      lessons: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          title: 'Evidence preparation',
          lessonType: 'article',
          position: 0,
          summary: 'Prepare evidence before the inspection.',
          articleBody: 'Review records, procedures and interview evidence.',
          assetPath: null,
          externalUrl: null,
          durationSeconds: 300,
          isPreview: false,
          isDownloadable: false,
          quiz: null,
        },
        {
          id: '33333333-3333-4333-8333-333333333333',
          title: 'SIRE knowledge check',
          lessonType: 'quiz',
          position: 1,
          summary: 'Check core knowledge.',
          articleBody: null,
          assetPath: null,
          externalUrl: null,
          durationSeconds: null,
          isPreview: false,
          isDownloadable: false,
          quiz: {
            id: '44444444-4444-4444-8444-444444444444',
            passPercentage: 80,
            instructions: 'Choose the best answer.',
            questions: [{
              id: '55555555-5555-4555-8555-555555555555',
              prompt: 'What should be prepared before inspection?',
              position: 0,
              options: [
                { id: '66666666-6666-4666-8666-666666666666', label: 'Only certificates', position: 0, isCorrect: false },
                { id: '77777777-7777-4777-8777-777777777777', label: 'Evidence, procedures and crew readiness', position: 1, isCorrect: true },
              ],
            }],
          },
        },
      ],
    }])

    const curriculumQuery = seen.find((entry) => entry.text.includes('from public.learning_course_sections section'))
    expect(curriculumQuery?.values).toEqual([[courseId]])
    expect(curriculumQuery?.text).toContain('option.is_correct')
    expect(curriculumQuery?.text).toContain('order by section.course_id, section.position, lesson.position, question.position, option.position')
  })

  it('requests changes transactionally, records reviewer feedback and writes an audit event', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_courses') && text.includes('for update')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'submitted' }]
      }
      if (text.includes('update public.learning_courses')) return [{ id: courseId }]
      return []
    }
    const repository = createLearningAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.reviewCourse(
      administratorId,
      courseId,
      'changes_requested',
      'Please make the outcomes measurable and add a vessel-specific example.',
    )).resolves.toEqual({ courseId, status: 'changes_requested' })

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.values).toEqual([
      courseId,
      'changes_requested',
      administratorId,
      'Please make the outcomes measurable and add a vessel-specific example.',
    ])
    expect(update?.text).toContain('reviewed_by = $3')
    expect(update?.text).toContain('reviewed_at = now()')
    expect(update?.text).toContain('admin_review_note = $4')
    expect(update?.text).toContain('approved_at = null')
    expect(update?.text).toContain('published_at = null')

    const audit = seen.find((entry) => entry.text.includes('insert into public.audit_events'))
    expect(audit?.values).toContain('learning.course.changes_requested')
    expect(audit?.values).toContain(courseId)
    expect(audit?.values).toContain(administratorId)
  })

  it('approves and publishes a submitted course atomically', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_courses') && text.includes('for update')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'submitted' }]
      }
      if (text.includes('update public.learning_courses')) return [{ id: courseId }]
      return []
    }
    const repository = createLearningAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.reviewCourse(administratorId, courseId, 'approved', null)).resolves.toEqual({
      courseId,
      status: 'published',
    })

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.text).toContain('approved_at = now()')
    expect(update?.text).toContain('published_at = now()')
    expect(update?.values).toEqual([courseId, 'published', administratorId, null])
    const audit = seen.find((entry) => entry.text.includes('insert into public.audit_events'))
    expect(audit?.values).toContain('learning.course.approved')
    expect(audit?.values?.some((value) => typeof value === 'string' && value.includes('"toStatus":"published"'))).toBe(true)
  })

  it('publishes only from approved and stamps published_at', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_courses') && text.includes('for update')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'approved' }]
      }
      if (text.includes('update public.learning_courses')) return [{ id: courseId }]
      return []
    }
    const repository = createLearningAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.reviewCourse(administratorId, courseId, 'published', null)).resolves.toEqual({
      courseId,
      status: 'published',
    })

    const update = seen.find((entry) => entry.text.includes('update public.learning_courses'))
    expect(update?.text).toContain('published_at = now()')
    expect(update?.values).toEqual([courseId, 'published', administratorId, null])
    expect(seen.find((entry) => entry.text.includes('insert into public.audit_events'))?.values).toContain('learning.course.published')
  })

  it('rejects an administrator transition that skips the course workflow', async () => {
    const query = async (text: string) => {
      if (text.includes('from public.user_roles')) return [{ allowed: true }]
      if (text.includes('from public.learning_courses') && text.includes('for update')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'submitted' }]
      }
      return []
    }
    const repository = createLearningAdminRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.reviewCourse(administratorId, courseId, 'published', null)).rejects.toThrow('course_transition_forbidden')
  })
})

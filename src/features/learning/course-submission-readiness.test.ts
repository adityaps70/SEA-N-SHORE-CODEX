import { describe, expect, it } from 'vitest'
import { createCourseRepository } from './course-repository'

const mentorUserId = '11111111-1111-4111-8111-111111111111'
const mentorId = '22222222-2222-4222-8222-222222222222'
const courseId = '33333333-3333-4333-8333-333333333333'
const sectionId = '44444444-4444-4444-8444-444444444444'
const materialId = '55555555-5555-4555-8555-555555555555'
const quizId = '66666666-6666-4666-8666-666666666666'
const questionId = '77777777-7777-4777-8777-777777777777'

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    section_id: sectionId,
    section_title: 'Module 1',
    section_position: 0,
    lesson_id: materialId,
    lesson_title: 'Inspection readiness article',
    lesson_type: 'article',
    lesson_position: 0,
    article_body: 'Practical inspection preparation content.',
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
    ...overrides,
  }
}

function repositoryWithCurriculum(rows: Record<string, unknown>[]) {
  const seen: Array<{ text: string; values?: readonly unknown[] }> = []
  const query = async (text: string, values?: readonly unknown[]) => {
    seen.push({ text, values })
    if (text.includes('for update') && text.includes('learning_courses')) {
      return [{ id: courseId, status: 'draft', mentor_id: mentorId }]
    }
    if (text.includes('learning_course_sections section') && text.includes('learning_lessons lesson')) return rows
    if (text.includes("set status = 'submitted'")) return [{ id: courseId }]
    return []
  }
  return {
    repository: createCourseRepository({ query, transaction: async (work) => work(query) }),
    seen,
  }
}

function statusWasUpdated(seen: Array<{ text: string }>) {
  return seen.some((entry) => entry.text.includes("set status = 'submitted'"))
}

describe('course submission readiness', () => {
  it('rejects submission when the course has no curriculum sections', async () => {
    const { repository, seen } = repositoryWithCurriculum([])

    await expect(repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_curriculum_empty',
    })
    expect(statusWasUpdated(seen)).toBe(false)
  })

  it('requires every visible section to contain at least one published material', async () => {
    const empty = repositoryWithCurriculum([
      baseRow({ lesson_id: null, lesson_title: null, lesson_type: null, lesson_position: null, article_body: null, is_published: null }),
    ])
    await expect(empty.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_section_empty',
      details: { sectionTitle: 'Module 1' },
    })

    const draftOnly = repositoryWithCurriculum([
      baseRow({ is_published: false, article_body: null }),
    ])
    await expect(draftOnly.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_section_empty',
      details: { sectionTitle: 'Module 1' },
    })
  })

  it('ignores unfinished unpublished drafts when the section also has a valid published material', async () => {
    const { repository, seen } = repositoryWithCurriculum([
      baseRow(),
      baseRow({
        lesson_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lesson_title: 'Future draft video',
        lesson_type: 'video',
        lesson_position: 1,
        article_body: null,
        asset_path: null,
        external_url: null,
        is_published: false,
        completion_rule: 'media_percentage',
        completion_threshold: 90,
      }),
    ])

    await expect(repository.submitCourse(mentorUserId, courseId)).resolves.toBe(true)
    expect(statusWasUpdated(seen)).toBe(true)
  })

  it('validates required learner content for each published native material type', async () => {
    for (const [materialType, row] of [
      ['article', { article_body: null }],
      ['image', { article_body: null, asset_path: null }],
      ['video', { article_body: null, asset_path: null, external_url: null, completion_rule: 'media_percentage', completion_threshold: 90 }],
      ['external_embed', { article_body: null, external_url: null, embed_kind: 'youtube' }],
    ] as const) {
      const { repository } = repositoryWithCurriculum([baseRow({
        lesson_title: `${materialType} material`,
        lesson_type: materialType,
        ...row,
      })])

      await expect(repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
        code: 'course_material_content_missing',
        details: { materialTitle: `${materialType} material`, materialType },
      })
    }
  })

  it('allows native assignments but requires a complete assignment definition', async () => {
    const missing = repositoryWithCurriculum([baseRow({
      lesson_title: 'Onboard evidence task',
      lesson_type: 'assignment',
      article_body: null,
      completion_rule: 'assignment_submit',
      max_attempts: 2,
    })])
    await expect(missing.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_assignment_missing',
      details: { materialTitle: 'Onboard evidence task' },
    })

    const valid = repositoryWithCurriculum([baseRow({
      lesson_title: 'Onboard evidence task',
      lesson_type: 'assignment',
      article_body: null,
      completion_rule: 'assignment_submit',
      max_attempts: 2,
      assignment_instructions: 'Upload a short inspection-readiness evidence pack.',
      assignment_extensions: ['pdf'],
      assignment_max_upload_bytes: 10485760,
    })])
    await expect(valid.repository.submitCourse(mentorUserId, courseId)).resolves.toBe(true)
  })

  it('allows only processed ready SCORM packages to be submitted', async () => {
    const processing = repositoryWithCurriculum([baseRow({
      lesson_title: 'SIRE interactive package',
      lesson_type: 'scorm',
      article_body: null,
      asset_path: 'learning/course/scorm/source.zip',
      completion_rule: 'scorm_completion',
      scorm_status: 'processing',
      scorm_source_zip_path: 'learning/course/scorm/source.zip',
    })])
    await expect(processing.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_scorm_not_ready',
      details: { materialTitle: 'SIRE interactive package' },
    })

    const ready = repositoryWithCurriculum([baseRow({
      lesson_title: 'SIRE interactive package',
      lesson_type: 'scorm',
      article_body: null,
      asset_path: 'learning/course/scorm/source.zip',
      completion_rule: 'scorm_completion',
      scorm_status: 'ready',
      scorm_source_zip_path: 'learning/course/scorm/source.zip',
      scorm_launch_path: 'learning/course/scorm/extracted/index.html',
    })])
    await expect(ready.repository.submitCourse(mentorUserId, courseId)).resolves.toBe(true)
  })

  it('rejects invalid release, prerequisite and completion policy combinations', async () => {
    const badRelease = repositoryWithCurriculum([baseRow({ release_mode: 'scheduled', release_at: null })])
    await expect(badRelease.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_material_release_invalid',
      details: { materialTitle: 'Inspection readiness article' },
    })

    const badPrerequisite = repositoryWithCurriculum([baseRow({ prerequisite_lesson_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' })])
    await expect(badPrerequisite.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_material_prerequisite_invalid',
      details: { materialTitle: 'Inspection readiness article' },
    })

    const badCompletion = repositoryWithCurriculum([baseRow({ completion_rule: 'media_percentage', completion_threshold: 90 })])
    await expect(badCompletion.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_material_completion_invalid',
      details: { materialTitle: 'Inspection readiness article' },
    })
  })

  it('keeps live sessions blocked until native attendance completion is connected', async () => {
    const live = repositoryWithCurriculum([baseRow({
      lesson_title: 'Live mentor session',
      lesson_type: 'live_session',
      article_body: null,
      external_url: 'https://meet.example.com/session',
    })])
    await expect(live.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_activity_not_supported',
      details: { materialTitle: 'Live mentor session', materialType: 'live_session' },
    })
  })

  it('retains strict quiz assessment validation', async () => {
    const missingQuiz = repositoryWithCurriculum([baseRow({
      lesson_title: 'SIRE knowledge check',
      lesson_type: 'quiz',
      article_body: null,
      completion_rule: 'quiz_pass',
    })])
    await expect(missingQuiz.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_quiz_missing',
      details: { materialTitle: 'SIRE knowledge check' },
    })

    const missingQuestions = repositoryWithCurriculum([baseRow({
      lesson_title: 'SIRE knowledge check',
      lesson_type: 'quiz',
      article_body: null,
      completion_rule: 'quiz_pass',
      quiz_id: quizId,
      pass_percentage: 80,
    })])
    await expect(missingQuestions.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_quiz_questions_missing',
      details: { materialTitle: 'SIRE knowledge check' },
    })

    const badAnswerKey = repositoryWithCurriculum([
      baseRow({
        lesson_title: 'SIRE knowledge check',
        lesson_type: 'quiz',
        article_body: null,
        completion_rule: 'quiz_pass',
        quiz_id: quizId,
        pass_percentage: 80,
        question_id: questionId,
        question_position: 0,
        option_id: '88888888-8888-4888-8888-888888888888',
        option_is_correct: false,
      }),
      baseRow({
        lesson_title: 'SIRE knowledge check',
        lesson_type: 'quiz',
        article_body: null,
        completion_rule: 'quiz_pass',
        quiz_id: quizId,
        pass_percentage: 80,
        question_id: questionId,
        question_position: 0,
        option_id: '99999999-9999-4999-8999-999999999999',
        option_is_correct: false,
      }),
    ])
    await expect(badAnswerKey.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_quiz_correct_answer_invalid',
      details: { materialTitle: 'SIRE knowledge check', questionNumber: 1 },
    })
  })

  it('submits a complete mixed native-material curriculum', async () => {
    const { repository, seen } = repositoryWithCurriculum([
      baseRow(),
      baseRow({
        lesson_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lesson_title: 'Engine room photograph',
        lesson_type: 'image',
        lesson_position: 1,
        article_body: null,
        asset_path: 'learning/course/image.jpg',
        completion_rule: 'view',
      }),
      baseRow({
        lesson_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        lesson_title: 'OCIMF explainer',
        lesson_type: 'external_embed',
        lesson_position: 2,
        article_body: null,
        external_url: 'https://www.youtube.com/watch?v=abcdefghijk',
        embed_kind: 'youtube',
        completion_rule: 'view',
      }),
      baseRow({
        lesson_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        lesson_title: 'Onboard evidence task',
        lesson_type: 'assignment',
        lesson_position: 3,
        article_body: null,
        completion_rule: 'assignment_submit',
        max_attempts: 2,
        assignment_instructions: 'Upload your evidence pack.',
        assignment_extensions: ['pdf'],
        assignment_max_upload_bytes: 10485760,
      }),
      baseRow({
        lesson_id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        lesson_title: 'SIRE interactive package',
        lesson_type: 'scorm',
        lesson_position: 4,
        article_body: null,
        asset_path: 'learning/course/scorm/source.zip',
        completion_rule: 'scorm_completion',
        scorm_status: 'ready',
        scorm_source_zip_path: 'learning/course/scorm/source.zip',
        scorm_launch_path: 'learning/course/scorm/extracted/index.html',
      }),
      baseRow({
        lesson_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        lesson_title: 'SIRE knowledge check',
        lesson_type: 'quiz',
        lesson_position: 5,
        article_body: null,
        completion_rule: 'quiz_pass',
        max_attempts: 3,
        quiz_id: quizId,
        pass_percentage: 80,
        question_id: questionId,
        question_position: 0,
        option_id: '88888888-8888-4888-8888-888888888888',
        option_is_correct: false,
      }),
      baseRow({
        lesson_id: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        lesson_title: 'SIRE knowledge check',
        lesson_type: 'quiz',
        lesson_position: 5,
        article_body: null,
        completion_rule: 'quiz_pass',
        max_attempts: 3,
        quiz_id: quizId,
        pass_percentage: 80,
        question_id: questionId,
        question_position: 0,
        option_id: '99999999-9999-4999-8999-999999999999',
        option_is_correct: true,
      }),
    ])

    await expect(repository.submitCourse(mentorUserId, courseId)).resolves.toBe(true)
    expect(statusWasUpdated(seen)).toBe(true)

    const readinessQuery = seen.find((entry) => entry.text.includes('learning_course_sections section') && entry.text.includes('learning_lessons lesson'))
    expect(readinessQuery?.values).toEqual([courseId])
  })
})

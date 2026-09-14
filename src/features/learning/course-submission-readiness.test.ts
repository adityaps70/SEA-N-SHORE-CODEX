import { describe, expect, it } from 'vitest'
import { createCourseRepository } from './course-repository'

const mentorUserId = '11111111-1111-4111-8111-111111111111'
const mentorId = '22222222-2222-4222-8222-222222222222'
const courseId = '33333333-3333-4333-8333-333333333333'
const sectionId = '44444444-4444-4444-8444-444444444444'
const lessonId = '55555555-5555-4555-8555-555555555555'
const quizId = '66666666-6666-4666-8666-666666666666'
const questionId = '77777777-7777-4777-8777-777777777777'

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    section_id: sectionId,
    section_title: 'Module 1',
    section_position: 0,
    lesson_id: lessonId,
    lesson_title: 'Inspection readiness article',
    lesson_type: 'article',
    lesson_position: 0,
    article_body: 'Practical inspection preparation content.',
    asset_path: null,
    external_url: null,
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

  it('rejects submission when a section contains no lessons', async () => {
    const { repository, seen } = repositoryWithCurriculum([
      baseRow({ lesson_id: null, lesson_title: null, lesson_type: null, lesson_position: null, article_body: null }),
    ])

    await expect(repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_section_empty',
      details: { sectionTitle: 'Module 1' },
    })
    expect(statusWasUpdated(seen)).toBe(false)
  })

  it('rejects lesson types whose required learner content is missing', async () => {
    const article = repositoryWithCurriculum([baseRow({ article_body: null })])
    await expect(article.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_lesson_content_missing',
      details: { lessonTitle: 'Inspection readiness article', lessonType: 'article' },
    })
    expect(statusWasUpdated(article.seen)).toBe(false)

    const video = repositoryWithCurriculum([baseRow({
      lesson_title: 'Bridge resource video',
      lesson_type: 'video',
      article_body: null,
      asset_path: null,
      external_url: null,
    })])
    await expect(video.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_lesson_content_missing',
      details: { lessonTitle: 'Bridge resource video', lessonType: 'video' },
    })
  })

  it('rejects assignment and live-session lessons until their native completion flows exist', async () => {
    const assignment = repositoryWithCurriculum([baseRow({
      lesson_title: 'Onboard assignment',
      lesson_type: 'assignment',
      article_body: null,
    })])
    await expect(assignment.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_activity_not_supported',
      details: { lessonTitle: 'Onboard assignment', lessonType: 'assignment' },
    })

    const live = repositoryWithCurriculum([baseRow({
      lesson_title: 'Live mentor session',
      lesson_type: 'live_session',
      article_body: null,
      external_url: 'https://meet.example.com/session',
    })])
    await expect(live.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_activity_not_supported',
      details: { lessonTitle: 'Live mentor session', lessonType: 'live_session' },
    })
  })

  it('rejects quizzes without a complete valid assessment definition', async () => {
    const missingQuiz = repositoryWithCurriculum([baseRow({
      lesson_title: 'SIRE knowledge check',
      lesson_type: 'quiz',
      article_body: null,
    })])
    await expect(missingQuiz.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_quiz_missing',
      details: { lessonTitle: 'SIRE knowledge check' },
    })

    const missingQuestions = repositoryWithCurriculum([baseRow({
      lesson_title: 'SIRE knowledge check',
      lesson_type: 'quiz',
      article_body: null,
      quiz_id: quizId,
      pass_percentage: 80,
    })])
    await expect(missingQuestions.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_quiz_questions_missing',
      details: { lessonTitle: 'SIRE knowledge check' },
    })

    const tooFewOptions = repositoryWithCurriculum([baseRow({
      lesson_title: 'SIRE knowledge check',
      lesson_type: 'quiz',
      article_body: null,
      quiz_id: quizId,
      pass_percentage: 80,
      question_id: questionId,
      question_position: 0,
      option_id: '88888888-8888-4888-8888-888888888888',
      option_is_correct: true,
    })])
    await expect(tooFewOptions.repository.submitCourse(mentorUserId, courseId)).rejects.toMatchObject({
      code: 'course_quiz_options_invalid',
      details: { lessonTitle: 'SIRE knowledge check', questionNumber: 1 },
    })

    const badAnswerKey = repositoryWithCurriculum([
      baseRow({
        lesson_title: 'SIRE knowledge check',
        lesson_type: 'quiz',
        article_body: null,
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
      details: { lessonTitle: 'SIRE knowledge check', questionNumber: 1 },
    })
  })

  it('submits only after a complete supported curriculum passes validation', async () => {
    const { repository, seen } = repositoryWithCurriculum([
      baseRow(),
      baseRow({
        lesson_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lesson_title: 'SIRE knowledge check',
        lesson_type: 'quiz',
        lesson_position: 1,
        article_body: null,
        quiz_id: quizId,
        pass_percentage: 80,
        question_id: questionId,
        question_position: 0,
        option_id: '88888888-8888-4888-8888-888888888888',
        option_is_correct: false,
      }),
      baseRow({
        lesson_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        lesson_title: 'SIRE knowledge check',
        lesson_type: 'quiz',
        lesson_position: 1,
        article_body: null,
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

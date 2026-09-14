import { describe, expect, it } from 'vitest'
import {
  createMentorCurriculumRepository,
  type MentorLessonDraft,
  type MentorQuizDefinitionInput,
} from './mentor-curriculum-repository'

const mentorUserId = '11111111-1111-4111-8111-111111111111'
const mentorId = '22222222-2222-4222-8222-222222222222'
const courseId = '33333333-3333-4333-8333-333333333333'
const sectionA = '44444444-4444-4444-8444-444444444444'
const sectionB = '55555555-5555-4555-8555-555555555555'
const lessonId = '66666666-6666-4666-8666-666666666666'
const quizId = '77777777-7777-4777-8777-777777777777'
const questionA = '88888888-8888-4888-8888-888888888888'
const optionA = '99999999-9999-4999-8999-999999999999'
const optionB = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'

function articleLesson(overrides: Partial<MentorLessonDraft> = {}): MentorLessonDraft {
  return {
    title: 'Preparing for the inspection',
    lessonType: 'article',
    summary: 'A practical overview of onboard preparation.',
    articleBody: 'Use this lesson to prepare evidence, records and the shipboard team before inspection.',
    assetPath: null,
    externalUrl: null,
    durationSeconds: null,
    isPreview: false,
    isDownloadable: false,
    ...overrides,
  }
}

function quizDefinition(): MentorQuizDefinitionInput {
  return {
    passPercentage: 80,
    instructions: 'Choose the best answer for each question.',
    questions: [
      {
        prompt: 'What should be verified before a SIRE 2.0 inspection?',
        options: [
          { label: 'Only the vessel certificate folder', isCorrect: false },
          { label: 'Evidence, procedures and crew readiness', isCorrect: true },
        ],
      },
    ],
  }
}

describe('mentor curriculum repository', () => {
  it('reads only curriculum owned by an active mentor and nests quiz definitions in persisted order', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const repository = createMentorCurriculumRepository({
      query: async (text, values) => {
        seen.push({ text, values })
        return [
          {
            course_id: courseId,
            course_status: 'draft',
            section_id: sectionA,
            section_title: 'Module 1',
            section_position: 0,
            lesson_id: lessonId,
            lesson_title: 'Knowledge check',
            lesson_type: 'quiz',
            lesson_position: 0,
            lesson_summary: 'Check inspection readiness knowledge.',
            article_body: null,
            asset_path: null,
            external_url: null,
            duration_seconds: null,
            is_preview: false,
            is_downloadable: false,
            quiz_id: quizId,
            pass_percentage: 80,
            quiz_instructions: 'Choose the best answer for each question.',
            question_id: questionA,
            question_prompt: 'What should be verified before a SIRE 2.0 inspection?',
            question_position: 0,
            option_id: optionA,
            option_label: 'Only the vessel certificate folder',
            option_position: 0,
            option_is_correct: false,
          },
          {
            course_id: courseId,
            course_status: 'draft',
            section_id: sectionA,
            section_title: 'Module 1',
            section_position: 0,
            lesson_id: lessonId,
            lesson_title: 'Knowledge check',
            lesson_type: 'quiz',
            lesson_position: 0,
            lesson_summary: 'Check inspection readiness knowledge.',
            article_body: null,
            asset_path: null,
            external_url: null,
            duration_seconds: null,
            is_preview: false,
            is_downloadable: false,
            quiz_id: quizId,
            pass_percentage: 80,
            quiz_instructions: 'Choose the best answer for each question.',
            question_id: questionA,
            question_prompt: 'What should be verified before a SIRE 2.0 inspection?',
            question_position: 0,
            option_id: optionB,
            option_label: 'Evidence, procedures and crew readiness',
            option_position: 1,
            option_is_correct: true,
          },
        ]
      },
    })

    await expect(repository.getCurriculum(mentorUserId, courseId)).resolves.toEqual({
      courseId,
      status: 'draft',
      sections: [
        {
          id: sectionA,
          title: 'Module 1',
          position: 0,
          lessons: [
            {
              id: lessonId,
              title: 'Knowledge check',
              lessonType: 'quiz',
              position: 0,
              summary: 'Check inspection readiness knowledge.',
              articleBody: null,
              assetPath: null,
              externalUrl: null,
              durationSeconds: null,
              isPreview: false,
              isDownloadable: false,
              quiz: {
                id: quizId,
                passPercentage: 80,
                instructions: 'Choose the best answer for each question.',
                questions: [
                  {
                    id: questionA,
                    prompt: 'What should be verified before a SIRE 2.0 inspection?',
                    position: 0,
                    options: [
                      { id: optionA, label: 'Only the vessel certificate folder', position: 0, isCorrect: false },
                      { id: optionB, label: 'Evidence, procedures and crew readiness', position: 1, isCorrect: true },
                    ],
                  },
                ],
              },
            },
          ],
        },
      ],
    })

    expect(seen[0]?.text).toContain('mentor.user_id = $1')
    expect(seen[0]?.text).toContain("mentor.status = 'active'")
    expect(seen[0]?.text).toContain('course.id = $2')
    expect(seen[0]?.values).toEqual([mentorUserId, courseId])
  })

  it('creates sections at the next dense position only while the owned course is editable', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('for update') && text.includes('learning_courses')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'draft' }]
      }
      if (text.includes('coalesce(max(position)')) return [{ next_position: 2 }]
      if (text.includes('insert into public.learning_course_sections')) return [{ id: sectionB }]
      return []
    }
    const repository = createMentorCurriculumRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.createSection(mentorUserId, courseId, 'Module 2')).resolves.toEqual({ sectionId: sectionB })

    const lock = seen.find((entry) => entry.text.includes('for update') && entry.text.includes('learning_courses'))
    expect(lock?.text).toContain('mentor.user_id = $2')
    expect(lock?.text).toContain("mentor.status = 'active'")
    expect(lock?.values).toEqual([courseId, mentorUserId])

    const insert = seen.find((entry) => entry.text.includes('insert into public.learning_course_sections'))
    expect(insert?.values).toEqual([courseId, 'Module 2', 2])
  })

  it('fails closed when curriculum mutation targets a submitted course', async () => {
    const seen: string[] = []
    const query = async (text: string) => {
      seen.push(text)
      if (text.includes('for update') && text.includes('learning_courses')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'submitted' }]
      }
      return []
    }
    const repository = createMentorCurriculumRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.createSection(mentorUserId, courseId, 'Should not save')).rejects.toThrow('course_edit_forbidden')
    expect(seen.some((text) => text.includes('insert into public.learning_course_sections'))).toBe(false)
  })

  it('creates lessons inside an owned section at the next persisted position', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('for update') && text.includes('learning_courses')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'changes_requested' }]
      }
      if (text.includes('from public.learning_course_sections') && text.includes('course_id = $1')) {
        return [{ id: sectionA }]
      }
      if (text.includes('coalesce(max(position)')) return [{ next_position: 1 }]
      if (text.includes('insert into public.learning_lessons')) return [{ id: lessonId }]
      return []
    }
    const repository = createMentorCurriculumRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.createLesson(mentorUserId, courseId, sectionA, articleLesson())).resolves.toEqual({ lessonId })

    const insert = seen.find((entry) => entry.text.includes('insert into public.learning_lessons'))
    expect(insert?.values).toEqual([
      sectionA,
      'Preparing for the inspection',
      'article',
      1,
      'A practical overview of onboard preparation.',
      'Use this lesson to prepare evidence, records and the shipboard team before inspection.',
      null,
      null,
      null,
      false,
      false,
    ])
  })

  it('moves sections by swapping adjacent persisted positions without changing ownership', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('for update') && text.includes('learning_courses')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'draft' }]
      }
      if (text.includes('from public.learning_course_sections') && text.includes('order by position')) {
        return [
          { id: sectionA, position: 0 },
          { id: sectionB, position: 1 },
        ]
      }
      if (text.includes('update public.learning_course_sections')) return [{ id: sectionB }]
      return []
    }
    const repository = createMentorCurriculumRepository({ query, transaction: async (work) => work(query) })

    await expect(repository.moveSection(mentorUserId, courseId, sectionB, 'up')).resolves.toBe(true)

    const updates = seen.filter((entry) => entry.text.includes('update public.learning_course_sections'))
    expect(updates).toHaveLength(3)
    expect(updates.map((entry) => entry.values)).toEqual([
      [sectionB, 2],
      [sectionA, 1],
      [sectionB, 0],
    ])
  })

  it('replaces a quiz definition atomically for an owned editable quiz lesson', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query = async (text: string, values?: readonly unknown[]) => {
      seen.push({ text, values })
      if (text.includes('for update') && text.includes('learning_courses')) {
        return [{ id: courseId, mentor_id: mentorId, status: 'draft' }]
      }
      if (text.includes('from public.learning_lessons lesson') && text.includes('lesson.lesson_type')) {
        return [{ id: lessonId, lesson_type: 'quiz' }]
      }
      if (text.includes('insert into public.learning_quizzes')) return [{ id: quizId }]
      if (text.includes('insert into public.learning_quiz_questions')) return [{ id: questionA }]
      if (text.includes('insert into public.learning_quiz_options')) return [{ id: optionA }]
      return []
    }
    let transactionCalls = 0
    const repository = createMentorCurriculumRepository({
      query,
      transaction: async (work) => {
        transactionCalls += 1
        return work(query)
      },
    })

    await expect(repository.saveQuizDefinition(mentorUserId, courseId, lessonId, quizDefinition())).resolves.toBe(true)

    expect(transactionCalls).toBe(1)
    expect(seen.some((entry) => entry.text.includes('delete from public.learning_quizzes') && entry.values?.[0] === lessonId)).toBe(true)
    expect(seen.find((entry) => entry.text.includes('insert into public.learning_quizzes'))?.values).toEqual([
      lessonId,
      80,
      'Choose the best answer for each question.',
    ])
    const optionWrites = seen.filter((entry) => entry.text.includes('insert into public.learning_quiz_options'))
    expect(optionWrites.map((entry) => entry.values)).toEqual([
      [questionA, 'Only the vessel certificate folder', 0, false],
      [questionA, 'Evidence, procedures and crew readiness', 1, true],
    ])
  })
})

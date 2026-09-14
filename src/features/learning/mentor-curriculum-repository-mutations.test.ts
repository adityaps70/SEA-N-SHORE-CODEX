import { describe, expect, it } from 'vitest'
import {
  createMentorCurriculumRepository,
  type MentorLessonDraft,
} from './mentor-curriculum-repository'

const actorId = '11111111-1111-4111-8111-111111111111'
const mentorId = '22222222-2222-4222-8222-222222222222'
const courseId = '33333333-3333-4333-8333-333333333333'
const sectionA = '44444444-4444-4444-8444-444444444444'
const sectionB = '55555555-5555-4555-8555-555555555555'
const lessonA = '66666666-6666-4666-8666-666666666666'
const lessonB = '77777777-7777-4777-8777-777777777777'

type Row = Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>
type Transaction = <T>(work: (query: Query) => Promise<T>) => Promise<T>

function transactionFor(query: Query): Transaction {
  return async <T>(work: (query: Query) => Promise<T>) => work(query)
}

function draft(overrides: Partial<MentorLessonDraft> = {}): MentorLessonDraft {
  return {
    title: 'Updated article lesson',
    lessonType: 'article',
    summary: 'Updated summary',
    articleBody: 'Updated article content that will be rendered to enrolled learners.',
    assetPath: null,
    externalUrl: null,
    durationSeconds: 180,
    isPreview: false,
    isDownloadable: false,
    ...overrides,
  }
}

function editableCourse(text: string) {
  return text.includes('for update') && text.includes('learning_courses')
}

describe('mentor curriculum repository mutations', () => {
  it('updates only a section belonging to the editable owned course', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query: Query = async (text, values) => {
      seen.push({ text, values })
      if (editableCourse(text)) return [{ id: courseId, mentor_id: mentorId, status: 'draft' }]
      if (text.includes('update public.learning_course_sections')) return [{ id: sectionA }]
      return []
    }
    const repository = createMentorCurriculumRepository({ query, transaction: transactionFor(query) })

    await expect(repository.updateSection(actorId, courseId, sectionA, 'Updated module')).resolves.toBe(true)

    const update = seen.find((entry) => entry.text.includes('update public.learning_course_sections'))
    expect(update?.text).toContain('course_id = $2')
    expect(update?.values).toEqual([sectionA, courseId, 'Updated module'])
  })

  it('deletes an owned section and compacts remaining section positions', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query: Query = async (text, values) => {
      seen.push({ text, values })
      if (editableCourse(text)) return [{ id: courseId, mentor_id: mentorId, status: 'changes_requested' }]
      if (text.includes('delete from public.learning_course_sections')) return [{ id: sectionA }]
      if (text.includes('from public.learning_course_sections') && text.includes('order by position')) {
        return [{ id: sectionB, position: 1 }]
      }
      if (text.includes('update public.learning_course_sections')) return [{ id: sectionB }]
      return []
    }
    const repository = createMentorCurriculumRepository({ query, transaction: transactionFor(query) })

    await expect(repository.deleteSection(actorId, courseId, sectionA)).resolves.toBe(true)

    expect(seen.find((entry) => entry.text.includes('delete from public.learning_course_sections'))?.values).toEqual([
      sectionA,
      courseId,
    ])
    expect(seen.filter((entry) => entry.text.includes('update public.learning_course_sections')).map((entry) => entry.values)).toEqual([
      [sectionB, 0],
    ])
  })

  it('updates lesson content only when the lesson belongs to the editable course', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query: Query = async (text, values) => {
      seen.push({ text, values })
      if (editableCourse(text)) return [{ id: courseId, mentor_id: mentorId, status: 'draft' }]
      if (text.includes('update public.learning_lessons')) return [{ id: lessonA }]
      return []
    }
    const repository = createMentorCurriculumRepository({ query, transaction: transactionFor(query) })

    await expect(repository.updateLesson(actorId, courseId, lessonA, draft())).resolves.toBe(true)

    const update = seen.find((entry) => entry.text.includes('update public.learning_lessons'))
    expect(update?.text).toContain('section.course_id = $2')
    expect(update?.values).toEqual([
      lessonA,
      courseId,
      'Updated article lesson',
      'article',
      'Updated summary',
      'Updated article content that will be rendered to enrolled learners.',
      null,
      null,
      180,
      false,
      false,
    ])
  })

  it('deletes a lesson and compacts positions only within its persisted section', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query: Query = async (text, values) => {
      seen.push({ text, values })
      if (editableCourse(text)) return [{ id: courseId, mentor_id: mentorId, status: 'draft' }]
      if (text.includes('select lesson.id, lesson.section_id') && text.includes('section.course_id')) {
        return [{ id: lessonA, section_id: sectionA }]
      }
      if (text.includes('delete from public.learning_lessons')) return [{ id: lessonA }]
      if (text.includes('from public.learning_lessons') && text.includes('order by position')) {
        return [{ id: lessonB, position: 1 }]
      }
      if (text.includes('update public.learning_lessons')) return [{ id: lessonB }]
      return []
    }
    const repository = createMentorCurriculumRepository({ query, transaction: transactionFor(query) })

    await expect(repository.deleteLesson(actorId, courseId, lessonA)).resolves.toBe(true)

    expect(seen.find((entry) => entry.text.includes('delete from public.learning_lessons'))?.values).toEqual([lessonA])
    const compaction = seen.filter((entry) => entry.text.includes('update public.learning_lessons'))
    expect(compaction.map((entry) => entry.values)).toEqual([[lessonB, 0]])
  })

  it('moves lessons with a temporary position inside their owned section', async () => {
    const seen: Array<{ text: string; values?: readonly unknown[] }> = []
    const query: Query = async (text, values) => {
      seen.push({ text, values })
      if (editableCourse(text)) return [{ id: courseId, mentor_id: mentorId, status: 'draft' }]
      if (text.includes('select lesson.id, lesson.section_id') && text.includes('section.course_id')) {
        return [{ id: lessonB, section_id: sectionA }]
      }
      if (text.includes('from public.learning_lessons') && text.includes('order by position')) {
        return [
          { id: lessonA, position: 0 },
          { id: lessonB, position: 1 },
        ]
      }
      if (text.includes('update public.learning_lessons')) return [{ id: lessonB }]
      return []
    }
    const repository = createMentorCurriculumRepository({ query, transaction: transactionFor(query) })

    await expect(repository.moveLesson(actorId, courseId, lessonB, 'up')).resolves.toBe(true)

    expect(seen.filter((entry) => entry.text.includes('update public.learning_lessons')).map((entry) => entry.values)).toEqual([
      [lessonB, 2],
      [lessonA, 1],
      [lessonB, 0],
    ])
  })
})

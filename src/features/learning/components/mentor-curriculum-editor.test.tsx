import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MentorCurriculum } from '../mentor-curriculum-repository'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  createSection: vi.fn(),
  updateSection: vi.fn(),
  deleteSection: vi.fn(),
  moveSection: vi.fn(),
  createLesson: vi.fn(),
  updateLesson: vi.fn(),
  deleteLesson: vi.fn(),
  moveLesson: vi.fn(),
  saveQuiz: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../mentor-curriculum-actions', () => ({
  createCurriculumSection: mocks.createSection,
  updateCurriculumSection: mocks.updateSection,
  deleteCurriculumSection: mocks.deleteSection,
  moveCurriculumSection: mocks.moveSection,
  createCurriculumLesson: mocks.createLesson,
  updateCurriculumLesson: mocks.updateLesson,
  deleteCurriculumLesson: mocks.deleteLesson,
  moveCurriculumLesson: mocks.moveLesson,
  saveCurriculumQuiz: mocks.saveQuiz,
}))

import { MentorCurriculumEditor } from './mentor-curriculum-editor'

afterEach(() => cleanup())

const courseId = '33333333-3333-4333-8333-333333333333'
const sectionId = '44444444-4444-4444-8444-444444444444'
const articleLessonId = '55555555-5555-4555-8555-555555555555'
const quizLessonId = '66666666-6666-4666-8666-666666666666'

const curriculum: MentorCurriculum = {
  courseId,
  status: 'draft',
  sections: [
    {
      id: sectionId,
      title: 'Module 1 · Inspection readiness',
      position: 0,
      lessons: [
        {
          id: articleLessonId,
          title: 'Evidence and crew preparation',
          lessonType: 'article',
          position: 0,
          summary: 'Prepare shipboard evidence and the team.',
          articleBody: 'Review records, procedures and crew readiness before inspection.',
          assetPath: null,
          externalUrl: null,
          durationSeconds: 360,
          isPreview: false,
          isDownloadable: false,
          quiz: null,
        },
        {
          id: quizLessonId,
          title: 'SIRE knowledge check',
          lessonType: 'quiz',
          position: 1,
          summary: 'Check core inspection knowledge.',
          articleBody: null,
          assetPath: null,
          externalUrl: null,
          durationSeconds: null,
          isPreview: false,
          isDownloadable: false,
          quiz: {
            id: '77777777-7777-4777-8777-777777777777',
            passPercentage: 80,
            instructions: 'Choose the best answer.',
            questions: [
              {
                id: '88888888-8888-4888-8888-888888888888',
                prompt: 'What should be prepared before inspection?',
                position: 0,
                options: [
                  { id: '99999999-9999-4999-8999-999999999999', label: 'Only certificates', position: 0, isCorrect: false },
                  { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', label: 'Evidence, procedures and crew readiness', position: 1, isCorrect: true },
                ],
              },
            ],
          },
        },
      ],
    },
  ],
}

describe('MentorCurriculumEditor', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const action of [
      mocks.createSection,
      mocks.updateSection,
      mocks.deleteSection,
      mocks.moveSection,
      mocks.createLesson,
      mocks.updateLesson,
      mocks.deleteLesson,
      mocks.moveLesson,
      mocks.saveQuiz,
    ]) action.mockResolvedValue({ ok: true })
    mocks.createSection.mockResolvedValue({ ok: true, sectionId })
    mocks.createLesson.mockResolvedValue({ ok: true, lessonId: articleLessonId })
  })

  it('renders persisted sections, lessons and accessible ordering controls', () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)

    expect(screen.getByRole('heading', { name: 'Curriculum' })).toBeInTheDocument()
    expect(screen.getByText('Module 1 · Inspection readiness')).toBeInTheDocument()
    expect(screen.getByText('Evidence and crew preparation')).toBeInTheDocument()
    expect(screen.getByText('SIRE knowledge check')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move Module 1 · Inspection readiness up' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Move SIRE knowledge check up' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move Evidence and crew preparation down' })).toBeEnabled()
  })

  it('adds a normalized section through the validated action and refreshes server state', async () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)

    fireEvent.change(screen.getByLabelText('New section title'), { target: { value: ' Module 2 · Human factors ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))

    await waitFor(() => expect(mocks.createSection).toHaveBeenCalledWith(courseId, ' Module 2 · Human factors '))
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('creates an article lesson with type-specific authoring fields', async () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add lesson to Module 1 · Inspection readiness' }))
    fireEvent.change(screen.getByLabelText('New lesson title'), { target: { value: 'Emergency towing preparation' } })
    fireEvent.change(screen.getByLabelText('New lesson type'), { target: { value: 'article' } })
    fireEvent.change(screen.getByLabelText('New lesson article content'), { target: { value: 'Review equipment, procedures and assigned responsibilities.' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create lesson' }))

    await waitFor(() => expect(mocks.createLesson).toHaveBeenCalledWith(courseId, sectionId, expect.objectContaining({
      title: 'Emergency towing preparation',
      lessonType: 'article',
      articleBody: 'Review equipment, procedures and assigned responsibilities.',
      assetPath: null,
      externalUrl: null,
      isPreview: false,
      isDownloadable: false,
    })))
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('routes section and lesson move/delete controls through server actions', async () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)

    fireEvent.click(screen.getByRole('button', { name: 'Move SIRE knowledge check up' }))
    await waitFor(() => expect(mocks.moveLesson).toHaveBeenCalledWith(courseId, quizLessonId, 'up'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete Evidence and crew preparation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Evidence and crew preparation' }))
    await waitFor(() => expect(mocks.deleteLesson).toHaveBeenCalledWith(courseId, articleLessonId))
  })

  it('edits a persisted lesson and preserves its current lesson type content', async () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit Evidence and crew preparation' }))
    fireEvent.change(screen.getByLabelText('Edit lesson title'), { target: { value: 'Evidence, records and crew preparation' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save lesson changes' }))

    await waitFor(() => expect(mocks.updateLesson).toHaveBeenCalledWith(courseId, articleLessonId, expect.objectContaining({
      title: 'Evidence, records and crew preparation',
      lessonType: 'article',
      articleBody: 'Review records, procedures and crew readiness before inspection.',
    })))
  })

  it('renders the nested quiz editor and atomically saves the answer key', async () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit quiz SIRE knowledge check' }))
    expect(screen.getByLabelText('Quiz pass percentage')).toHaveValue(80)
    expect(screen.getByLabelText('Question 1 prompt')).toHaveValue('What should be prepared before inspection?')
    expect(screen.getByLabelText('Question 1 option 2 correct')).toBeChecked()

    fireEvent.change(screen.getByLabelText('Quiz pass percentage'), { target: { value: '85' } })
    fireEvent.change(screen.getByLabelText('Question 1 prompt'), { target: { value: 'What evidence should be prepared before inspection?' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save quiz' }))

    await waitFor(() => expect(mocks.saveQuiz).toHaveBeenCalledWith(courseId, quizLessonId, {
      passPercentage: 85,
      instructions: 'Choose the best answer.',
      questions: [
        {
          prompt: 'What evidence should be prepared before inspection?',
          options: [
            { label: 'Only certificates', isCorrect: false },
            { label: 'Evidence, procedures and crew readiness', isCorrect: true },
          ],
        },
      ],
    }))
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('supports adding and removing quiz questions and answer options without inventing content', () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)

    fireEvent.click(screen.getByRole('button', { name: 'Edit quiz SIRE knowledge check' }))
    fireEvent.click(screen.getByRole('button', { name: 'Add question' }))

    expect(screen.getByLabelText('Question 2 prompt')).toHaveValue('')
    expect(screen.getByLabelText('Question 2 option 1')).toHaveValue('')
    expect(screen.getByLabelText('Question 2 option 2')).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: 'Add option to question 2' }))
    expect(screen.getByLabelText('Question 2 option 3')).toHaveValue('')
    fireEvent.click(screen.getByRole('button', { name: 'Remove question 2' }))
    expect(screen.queryByLabelText('Question 2 prompt')).not.toBeInTheDocument()
  })

  it('shows action errors without refreshing stale state', async () => {
    mocks.createSection.mockResolvedValueOnce({ ok: false, error: 'Section title is required.' })
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)

    fireEvent.change(screen.getByLabelText('New section title'), { target: { value: ' ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Section title is required.')
    expect(mocks.refresh).not.toHaveBeenCalled()
  })
})

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MentorMaterialCurriculum } from '../mentor-material-repository'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  createSection: vi.fn(),
  updateSection: vi.fn(),
  deleteSection: vi.fn(),
  moveSection: vi.fn(),
  deleteMaterial: vi.fn(),
  moveMaterial: vi.fn(),
  saveQuiz: vi.fn(),
  createMaterial: vi.fn(),
  updateMaterial: vi.fn(),
  updateNavigation: vi.fn(),
  processScorm: vi.fn(),
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: mocks.refresh }) }))
vi.mock('../mentor-curriculum-actions', () => ({
  createCurriculumSection: mocks.createSection,
  updateCurriculumSection: mocks.updateSection,
  deleteCurriculumSection: mocks.deleteSection,
  moveCurriculumSection: mocks.moveSection,
  deleteCurriculumLesson: mocks.deleteMaterial,
  moveCurriculumLesson: mocks.moveMaterial,
  saveCurriculumQuiz: mocks.saveQuiz,
}))
vi.mock('../mentor-material-actions', () => ({
  createCurriculumMaterial: mocks.createMaterial,
  updateCurriculumMaterial: mocks.updateMaterial,
  updateCourseNavigationMode: mocks.updateNavigation,
}))
vi.mock('../scorm-authoring-actions', () => ({
  processCurriculumScormPackage: mocks.processScorm,
}))
vi.mock('./learning-media-upload-field', () => ({
  LearningMediaUploadField: ({ label, inputAriaLabel, onChange }: { label: string; inputAriaLabel: string; onChange: (value: string) => void }) => (
    <button
      type="button"
      aria-label={inputAriaLabel}
      onClick={() => onChange(label === 'SCORM ZIP'
        ? 'learning/user/course/scorm_package/package.zip'
        : 'learning/user/course/material/file.bin')}
    >
      Attach {label}
    </button>
  ),
}))

import { MentorCurriculumEditor } from './mentor-curriculum-editor'

afterEach(() => cleanup())

const courseId = '33333333-3333-4333-8333-333333333333'
const sectionId = '44444444-4444-4444-8444-444444444444'
const articleMaterialId = '55555555-5555-4555-8555-555555555555'
const quizMaterialId = '66666666-6666-4666-8666-666666666666'
const createdMaterialId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'

const curriculum: MentorMaterialCurriculum = {
  courseId,
  status: 'draft',
  navigationMode: 'free',
  sections: [
    {
      id: sectionId,
      title: 'Module 1 · Inspection readiness',
      position: 0,
      materials: [
        {
          id: articleMaterialId,
          title: 'Evidence and crew preparation',
          materialType: 'article',
          position: 0,
          summary: 'Prepare shipboard evidence and the team.',
          articleBody: 'Review records, procedures and crew readiness before inspection.',
          assetPath: null,
          externalUrl: null,
          durationSeconds: 360,
          isPreview: false,
          isDownloadable: false,
          isPublished: true,
          releaseMode: 'immediate',
          releaseAt: null,
          dripDelayDays: null,
          prerequisiteLessonId: null,
          completionRule: 'view',
          completionThreshold: null,
          maxAttempts: null,
          embedKind: null,
          assignment: null,
          quiz: null,
          scorm: null,
        },
        {
          id: quizMaterialId,
          title: 'SIRE knowledge check',
          materialType: 'quiz',
          position: 1,
          summary: 'Check core inspection knowledge.',
          articleBody: null,
          assetPath: null,
          externalUrl: null,
          durationSeconds: null,
          isPreview: false,
          isDownloadable: false,
          isPublished: true,
          releaseMode: 'immediate',
          releaseAt: null,
          dripDelayDays: null,
          prerequisiteLessonId: articleMaterialId,
          completionRule: 'quiz_pass',
          completionThreshold: null,
          maxAttempts: 3,
          embedKind: null,
          assignment: null,
          scorm: null,
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

describe('MentorCurriculumEditor native materials', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const action of [
      mocks.createSection,
      mocks.updateSection,
      mocks.deleteSection,
      mocks.moveSection,
      mocks.deleteMaterial,
      mocks.moveMaterial,
      mocks.saveQuiz,
      mocks.updateMaterial,
      mocks.updateNavigation,
    ]) action.mockResolvedValue({ ok: true })
    mocks.createSection.mockResolvedValue({ ok: true, sectionId })
    mocks.createMaterial.mockResolvedValue({ ok: true, materialId: createdMaterialId })
    mocks.processScorm.mockResolvedValue({ ok: true, version: '2004', launchPath: 'index.html', fileCount: 9 })
  })

  it('renders native materials, navigation mode and ordering controls', () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)

    expect(screen.getByRole('heading', { name: 'Curriculum' })).toBeInTheDocument()
    expect(screen.getByLabelText('Course navigation mode')).toHaveValue('free')
    expect(screen.getByText('Evidence and crew preparation')).toBeInTheDocument()
    expect(screen.getByText('SIRE knowledge check')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Move SIRE knowledge check up' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Move Evidence and crew preparation down' })).toBeEnabled()
  })

  it('persists sequential course navigation through the native material action', async () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)
    fireEvent.change(screen.getByLabelText('Course navigation mode'), { target: { value: 'sequential' } })
    await waitFor(() => expect(mocks.updateNavigation).toHaveBeenCalledWith(courseId, 'sequential'))
    expect(mocks.refresh).toHaveBeenCalled()
  })

  it('adds sections through the existing section workflow', async () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)
    fireEvent.change(screen.getByLabelText('New section title'), { target: { value: ' Module 2 · Human factors ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add section' }))
    await waitFor(() => expect(mocks.createSection).toHaveBeenCalledWith(courseId, ' Module 2 · Human factors '))
  })

  it('creates first-class article materials with release, prerequisite and completion policy', async () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)

    fireEvent.click(screen.getByRole('button', { name: 'Add material to Module 1 · Inspection readiness' }))
    fireEvent.change(screen.getByLabelText('New material title'), { target: { value: 'Emergency towing preparation' } })
    fireEvent.change(screen.getByLabelText('New material article content'), { target: { value: 'Review equipment, procedures and assigned responsibilities.' } })
    fireEvent.change(screen.getByLabelText('New material release'), { target: { value: 'drip' } })
    fireEvent.change(screen.getByLabelText('New drip delay days'), { target: { value: '2' } })
    fireEvent.change(screen.getByLabelText('New material prerequisite'), { target: { value: articleMaterialId } })
    fireEvent.click(screen.getByRole('button', { name: 'Create material' }))

    await waitFor(() => expect(mocks.createMaterial).toHaveBeenCalledWith(courseId, sectionId, expect.objectContaining({
      title: 'Emergency towing preparation',
      materialType: 'article',
      articleBody: 'Review equipment, procedures and assigned responsibilities.',
      releaseMode: 'drip',
      dripDelayDays: 2,
      prerequisiteLessonId: articleMaterialId,
      completionRule: 'view',
      isPublished: true,
    })))
  })

  it('shows scheduled release, prerequisites and maximum attempts for assessment materials', () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add material to Module 1 · Inspection readiness' }))
    fireEvent.change(screen.getByLabelText('New material type'), { target: { value: 'assignment' } })

    expect(screen.getByRole('option', { name: 'Scheduled release' })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: 'Drip after enrollment' })).toBeInTheDocument()
    expect(screen.getByText('Prerequisite')).toBeInTheDocument()
    expect(screen.getByText(/Maximum attempts/)).toBeInTheDocument()
    expect(screen.getByLabelText('New assignment instructions')).toBeInTheDocument()
  })

  it('creates and immediately processes a SCORM ZIP package', async () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add material to Module 1 · Inspection readiness' }))
    fireEvent.change(screen.getByLabelText('New material title'), { target: { value: 'Interactive SIRE scenario' } })
    fireEvent.change(screen.getByLabelText('New material type'), { target: { value: 'scorm' } })
    fireEvent.click(screen.getByRole('button', { name: 'New SCORM ZIP file' }))
    fireEvent.change(screen.getByLabelText('New material maximum attempts'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create material' }))

    await waitFor(() => expect(mocks.createMaterial).toHaveBeenCalledWith(courseId, sectionId, expect.objectContaining({
      title: 'Interactive SIRE scenario',
      materialType: 'scorm',
      assetPath: 'learning/user/course/scorm_package/package.zip',
      completionRule: 'scorm_completion',
      maxAttempts: 2,
    })))
    await waitFor(() => expect(mocks.processScorm).toHaveBeenCalledWith(
      courseId,
      createdMaterialId,
      'learning/user/course/scorm_package/package.zip',
    ))
  })

  it('edits persisted material policy through the native update action', async () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit Evidence and crew preparation' }))
    fireEvent.change(screen.getByLabelText('Edit material title'), { target: { value: 'Evidence, records and crew preparation' } })
    fireEvent.change(screen.getByLabelText('Edit material release'), { target: { value: 'scheduled' } })
    fireEvent.change(screen.getByLabelText('Edit scheduled release date'), { target: { value: '2026-10-01T09:30' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save material changes' }))

    await waitFor(() => expect(mocks.updateMaterial).toHaveBeenCalledWith(courseId, articleMaterialId, expect.objectContaining({
      title: 'Evidence, records and crew preparation',
      materialType: 'article',
      releaseMode: 'scheduled',
      releaseAt: expect.stringContaining('2026-10-01'),
    })))
  })

  it('preserves the nested quiz editor and answer-key save flow', async () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)
    fireEvent.click(screen.getByRole('button', { name: 'Edit quiz SIRE knowledge check' }))
    expect(screen.getByLabelText('Quiz pass percentage')).toHaveValue(80)
    expect(screen.getByLabelText('Question 1 option 2 correct')).toBeChecked()
    fireEvent.change(screen.getByLabelText('Quiz pass percentage'), { target: { value: '85' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save quiz' }))

    await waitFor(() => expect(mocks.saveQuiz).toHaveBeenCalledWith(courseId, quizMaterialId, expect.objectContaining({ passPercentage: 85 })))
  })

  it('routes material ordering and deletion through persisted learning rows', async () => {
    render(<MentorCurriculumEditor courseId={courseId} curriculum={curriculum} />)
    fireEvent.click(screen.getByRole('button', { name: 'Move SIRE knowledge check up' }))
    await waitFor(() => expect(mocks.moveMaterial).toHaveBeenCalledWith(courseId, quizMaterialId, 'up'))

    fireEvent.click(screen.getByRole('button', { name: 'Delete Evidence and crew preparation' }))
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Evidence and crew preparation' }))
    await waitFor(() => expect(mocks.deleteMaterial).toHaveBeenCalledWith(courseId, articleMaterialId))
  })
})
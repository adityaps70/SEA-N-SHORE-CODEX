import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LearnerLesson } from '../learner-course-repository'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))
vi.mock('../learner-progress-actions', () => ({ completeLearningLesson: vi.fn(), recordLessonView: vi.fn(), saveLessonPosition: vi.fn(), recordLearningMediaProgress: vi.fn() }))
vi.mock('../scorm-actions', () => ({ startLearningScormAttempt: vi.fn(), commitLearningScormAttempt: vi.fn() }))

import { MaterialPlayer } from './material-player'

function lesson(overrides: Partial<LearnerLesson>): LearnerLesson {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    title: 'Inspection checklist',
    lessonType: 'pdf',
    position: 0,
    summary: null,
    articleBody: null,
    assetPath: 'learning/lessons/checklist.pdf',
    externalUrl: null,
    durationSeconds: null,
    isPreview: false,
    isDownloadable: false,
    completionRule: 'manual',
    completionThreshold: null,
    maxAttempts: null,
    attemptsUsed: 0,
    embedKind: null,
    completed: false,
    completedAt: null,
    lastPositionSeconds: 0,
    mediaPercent: 0,
    isAvailable: true,
    lockReason: null,
    releaseAt: null,
    dripDelayDays: null,
    assignment: null,
    scorm: null,
    ...overrides,
  } as LearnerLesson
}

afterEach(() => cleanup())

describe('MaterialPlayer on phones', () => {
  it('keeps the PDF iframe on desktop and offers "Open PDF" in a new tab on phones', () => {
    const { container } = render(<MaterialPlayer lesson={lesson({})} slug="sire" mediaUrl="https://signed.example/checklist.pdf" quiz={null} />)

    expect(container.querySelector('iframe')).toHaveClass('max-md:hidden')
    const open = screen.getByRole('link', { name: /Open PDF/ })
    expect(open).toHaveAttribute('href', 'https://signed.example/checklist.pdf')
    expect(open).toHaveAttribute('target', '_blank')
    expect(open.closest('div')).toHaveClass('md:hidden')
  })

  it('puts the phone actions (Curriculum n/N) beside Mark complete', () => {
    render(
      <MaterialPlayer
        lesson={lesson({ lessonType: 'article', articleBody: 'Read this.', assetPath: null })}
        slug="sire"
        mediaUrl={null}
        quiz={null}
        phoneActions={<button type="button">Curriculum 3/12</button>}
      />,
    )
    const complete = screen.getByRole('button', { name: 'Mark complete' })
    const row = complete.closest('div.max-md\\:flex') as HTMLElement
    expect(row).not.toBeNull()
    expect(within(row).getByRole('button', { name: 'Curriculum 3/12' })).toBeInTheDocument()
  })

  it('still shows the phone actions for a locked lesson and for lessons without Mark complete', () => {
    render(
      <MaterialPlayer
        lesson={lesson({ isAvailable: false, lockReason: 'prerequisite' })}
        slug="sire"
        mediaUrl={null}
        quiz={null}
        phoneActions={<button type="button">Curriculum 2/12</button>}
      />,
    )
    expect(screen.getByText('Material locked')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Curriculum 2/12' }).parentElement).toHaveClass('md:hidden')
  })

  it('tells phone learners SCORM works best on a computer', () => {
    render(
      <MaterialPlayer
        lesson={lesson({ lessonType: 'scorm', assetPath: null, completionRule: 'scorm_completion', scorm: { status: 'ready', version: '1.2', launchPath: 'index.html' } } as Partial<LearnerLesson>)}
        slug="sire"
        mediaUrl={null}
        quiz={null}
      />,
    )
    const note = screen.getByRole('note')
    expect(note).toHaveTextContent('works best on a computer')
    expect(note).toHaveClass('md:hidden')
    expect(screen.getByRole('button', { name: /Start SCORM material/ })).toBeInTheDocument()
  })

  it('keeps "Continue to next material" for desktop only (phones use the page\'s Next material pill)', () => {
    render(
      <MaterialPlayer
        lesson={lesson({ lessonType: 'article', articleBody: 'Read this.', assetPath: null, completed: true, completionRule: 'view' })}
        slug="sire"
        mediaUrl={null}
        quiz={null}
        nextLessonHref="/learn/courses/sire/learn?lesson=next"
      />,
    )
    const link = screen.getByRole('link', { name: /Continue to next material/ })
    expect(link).toHaveAttribute('href', '/learn/courses/sire/learn?lesson=next')
    expect(link).toHaveClass('max-md:hidden')
  })
})

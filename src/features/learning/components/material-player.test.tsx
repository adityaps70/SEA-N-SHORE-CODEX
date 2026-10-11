import { cleanup, render, screen } from '@testing-library/react'
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

  it('shows the locked notice for a locked lesson, without its content', () => {
    render(<MaterialPlayer lesson={lesson({ isAvailable: false, lockReason: 'prerequisite' })} slug="sire" mediaUrl={null} quiz={null} />)
    expect(screen.getByText('Material locked')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Open PDF/ })).not.toBeInTheDocument()
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

  it('leaves completing and moving on to the player\'s bottom bar (round E)', () => {
    render(
      <MaterialPlayer
        lesson={lesson({ lessonType: 'article', articleBody: 'Read this.', assetPath: null, completed: true, completionRule: 'manual' })}
        slug="sire"
        mediaUrl={null}
        quiz={null}
      />,
    )
    expect(screen.queryByRole('button', { name: /Mark complete|Complete/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Continue to next material/ })).not.toBeInTheDocument()
    expect(screen.queryByText('Completed')).not.toBeInTheDocument()
  })
})

describe('MaterialPlayer articles', () => {
  it('renders an article written before rich text exactly as before: plain text, line breaks kept', () => {
    const { container } = render(
      <MaterialPlayer lesson={lesson({ lessonType: 'article', articleFormat: 'plain', articleBody: 'Line one\n<b>not bold</b>', assetPath: null })} slug="sire" mediaUrl={null} quiz={null} />,
    )
    const body = container.querySelector('.whitespace-pre-wrap') as HTMLElement
    expect(body.textContent).toBe('Line one\n<b>not bold</b>')
    expect(container.querySelector('b')).toBeNull()
  })

  it('renders a rich-text article from the server-sanitized HTML only', () => {
    const { container } = render(
      <MaterialPlayer
        lesson={lesson({ lessonType: 'article', articleFormat: 'html', articleBody: '<p>raw <script>alert(1)</script></p>', assetPath: null })}
        articleHtml="<h2>Before boarding</h2><p>Check the <strong>VIQ</strong>.</p>"
        slug="sire"
        mediaUrl={null}
        quiz={null}
      />,
    )
    const article = container.querySelector('.lesson-article') as HTMLElement
    expect(article.querySelector('h2')).toHaveTextContent('Before boarding')
    expect(article.querySelector('strong')).toHaveTextContent('VIQ')
    expect(container.innerHTML).not.toContain('<script')
  })
})

describe('MaterialPlayer article reading (round E)', () => {
  it('shows the reading time and a reading-progress bar at a readable measure', () => {
    const body = Array.from({ length: 660 }, (_, index) => `word${index}`).join(' ')
    const { container } = render(
      <MaterialPlayer lesson={lesson({ lessonType: 'article', articleFormat: 'plain', articleBody: body, assetPath: null })} slug="sire" mediaUrl={null} quiz={null} />,
    )
    expect(screen.getByText('≈ 3 min read')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Reading progress' })).toHaveAttribute('aria-valuemax', '100')
    expect(container.querySelector('.lesson-article')).toHaveClass('max-w-[68ch]')
  })
})


import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  refresh: vi.fn(),
  push: vi.fn(),
  startLearningScormAttempt: vi.fn(),
  commitLearningScormAttempt: vi.fn(),
  completeLearningLesson: vi.fn(),
}))
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: mocks.push, refresh: mocks.refresh }) }))
vi.mock('../scorm-actions', () => ({
  startLearningScormAttempt: mocks.startLearningScormAttempt,
  commitLearningScormAttempt: mocks.commitLearningScormAttempt,
}))
vi.mock('../learner-progress-actions', () => ({ completeLearningLesson: mocks.completeLearningLesson }))

import { LessonActionBar } from './lesson-action-bar'
import { ScormPlayer } from './scorm-player'

/**
 * S2: the SCORM player fills the screen. A compact header (breadcrumb, duration, Save progress, Focus mode)
 * sits on the package; Focus mode lays the same frame over the window; completion and resume are unchanged.
 */
const lessonId = '11111111-1111-4111-8111-111111111111'
const attemptId = '22222222-2222-4222-8222-222222222222'
const header = { crumb: 'Module 1', title: 'Inclusiveness and consideration of others', duration: '4 min' }
const base = {
  slug: 'bridge-team-skills',
  lessonId,
  launchPath: 'index.html',
  version: '1.2' as const,
  maxAttempts: null,
  attemptsUsed: 0,
  initiallyCompleted: false,
  header,
}

function frame() {
  return screen.getByTitle('SCORM learning material') as HTMLIFrameElement
}

/** A message from the bridge inside the package (the player only trusts its own frame). */
function fromPackage(data: Record<string, unknown>) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data: { source: 'sns-scorm', ...data }, source: frame().contentWindow }))
  })
}

async function startAttempt() {
  const listen = vi.spyOn(window, 'addEventListener')
  fireEvent.click(screen.getByRole('button', { name: /Start SCORM material/ }))
  await screen.findByTitle('SCORM learning material')
  // The player starts listening to the bridge in an effect, which can run after the frame is on screen: wait for it,
  // or a message sent right away would be lost.
  await waitFor(() => expect(listen.mock.calls.some(([type]) => type === 'message')).toBe(true))
  listen.mockRestore()
}

describe('ScormPlayer (S2: full-height SCORM lessons)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.startLearningScormAttempt.mockResolvedValue({ ok: true, attemptId, attemptNumber: 1 })
    mocks.commitLearningScormAttempt.mockResolvedValue({ ok: true, completed: false })
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('has a compact one-line header: breadcrumb (Module › lesson) and duration, no big title', async () => {
    render(<ScormPlayer {...base} />)
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' })
    expect(within(crumbs).getByText('Module 1')).toBeInTheDocument()
    expect(within(crumbs).getByText(header.title)).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('4 min')).toBeInTheDocument()
    // The page keeps the sr-only h1; the player draws no heading of its own.
    expect(screen.queryByRole('heading')).not.toBeInTheDocument()
    // Before an attempt starts there is nothing to save or enlarge.
    expect(screen.queryByRole('button', { name: 'Save progress' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Focus mode/ })).not.toBeInTheDocument()

    await startAttempt()
    expect(document.querySelector('[data-scorm-header]')).toContainElement(screen.getByRole('button', { name: 'Save progress' }))
    // The old "SCORM 1.2 · Attempt 1 / Save progress" strip is gone.
    expect(screen.queryByText(/SCORM 1\.2 · Attempt/)).not.toBeInTheDocument()
  })

  it('fills the window height under the page chrome, at least 520px, across the full column', async () => {
    render(<ScormPlayer {...base} />)
    await startAttempt()
    expect(frame().style.height).toBe('max(520px, calc(100dvh - var(--scorm-chrome, 16.5rem)))')
    expect(frame()).toHaveClass('block', 'w-full', 'border-0')
    expect(frame().className).not.toMatch(/min-h-\[640px\]|70dvh/)
    // Measured from the frame's position (jsdom lays nothing out, so the frame reports no box and keeps the estimate).
    expect(frame().style.getPropertyValue('--scorm-chrome')).toBe('')
  })

  it('saves from a small icon button with a tooltip, then says "Saved" briefly in a polite live region', async () => {
    render(<ScormPlayer {...base} />)
    await startAttempt()
    const save = screen.getByRole('button', { name: 'Save progress' })
    expect(save).toHaveAccessibleDescription('Save progress (it also saves automatically)')
    expect(screen.getByRole('tooltip', { name: /Save progress/ })).toHaveAttribute('id', save.getAttribute('aria-describedby'))
    const status = screen.getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toBeEmptyDOMElement()

    vi.useFakeTimers()
    await act(async () => { fireEvent.click(save) })
    expect(mocks.commitLearningScormAttempt).toHaveBeenCalledWith(base.slug, attemptId, { 'cmi.core.lesson_status': 'not attempted' })
    expect(status).toHaveTextContent('Saved')
    expect(mocks.refresh).toHaveBeenCalledOnce()
    act(() => { vi.advanceTimersByTime(3000) })
    expect(status).toBeEmptyDOMElement()
  })

  it('keeps autosaving through the SCORM API, including the resume data (lesson_location, suspend_data)', async () => {
    render(<ScormPlayer {...base} />)
    await startAttempt()
    fromPackage({ type: 'set', key: 'cmi.core.lesson_location', value: 'slide-4' })
    fromPackage({ type: 'set', key: 'cmi.suspend_data', value: 'q1=a;q2=c' })
    // A message from anywhere else is ignored.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', { data: { source: 'sns-scorm', type: 'commit', values: {} }, source: window }))
    })
    expect(mocks.commitLearningScormAttempt).not.toHaveBeenCalled()

    fromPackage({ type: 'commit', values: { 'cmi.core.lesson_status': 'incomplete' } })
    await waitFor(() => expect(mocks.commitLearningScormAttempt).toHaveBeenCalledWith(base.slug, attemptId, {
      'cmi.core.lesson_status': 'incomplete',
      'cmi.core.lesson_location': 'slide-4',
      'cmi.suspend_data': 'q1=a;q2=c',
    }))
    expect(await screen.findByText('Saved')).toBeInTheDocument()
    // Autosave does not reload the page.
    expect(mocks.refresh).not.toHaveBeenCalled()
  })

  it('unlocks "Complete & next" when the package reports completion (cmi.core.lesson_status), gating it until then', async () => {
    render(
      <>
        <ScormPlayer {...base} />
        <LessonActionBar
          slug={base.slug}
          lessonId={lessonId}
          completionRule="scorm_completion"
          completed={false}
          available
          previousHref={null}
          nextHref="/learn/courses/bridge-team-skills/learn?lesson=next"
          finishHref="/learn/my-learning"
          docked={false}
        />
      </>,
    )
    await startAttempt()
    const bar = screen.getByRole('navigation', { name: 'Lesson navigation' })
    expect(within(bar).getByRole('button', { name: /Complete & next/ })).toBeDisabled()
    expect(screen.getAllByText('Finish the module to continue.').length).toBeGreaterThan(0)

    // Not complete yet on the server: still gated.
    fromPackage({ type: 'commit', values: { 'cmi.core.lesson_status': 'incomplete' } })
    await waitFor(() => expect(mocks.commitLearningScormAttempt).toHaveBeenCalledTimes(1))
    expect(within(bar).getByRole('button', { name: /Complete & next/ })).toBeDisabled()

    mocks.commitLearningScormAttempt.mockResolvedValueOnce({ ok: true, completed: true })
    fromPackage({ type: 'finish', values: { 'cmi.core.lesson_status': 'completed' } })
    expect(await within(bar).findByRole('link', { name: /Next lesson/ })).toHaveAttribute('href', '/learn/courses/bridge-team-skills/learn?lesson=next')
    expect(mocks.commitLearningScormAttempt).toHaveBeenLastCalledWith(base.slug, attemptId, { 'cmi.core.lesson_status': 'completed' })
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save progress' })).not.toBeInTheDocument()
  })

  it('Focus mode lays the same frame over the whole window; Esc leaves and focus returns to the button', async () => {
    render(
      <div>
        <a href="/elsewhere">Outside link</a>
        <ScormPlayer {...base} />
      </div>,
    )
    await startAttempt()
    const before = frame()
    const toggle = screen.getByRole('button', { name: 'Focus mode' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveAccessibleDescription('Fill the window with the module. Esc to leave.')

    fireEvent.click(toggle)
    const stage = document.querySelector('[data-scorm-stage]') as HTMLElement
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(toggle).toHaveTextContent('Exit focus mode')
    expect(stage).toHaveAttribute('data-focus-mode', 'on')
    expect(stage).toHaveClass('fixed', 'inset-0', 'flex', 'flex-col')
    expect(frame()).toHaveClass('flex-1')
    expect(frame().style.height).toBe('')
    // Not re-mounted (the SCORM runtime stays attached): the very same element, same address.
    expect(frame()).toBe(before)
    expect(frame().getAttribute('src')).toBe(`/api/learning/scorm/${lessonId}/content/index.html`)
    // The page behind cannot be reached with Tab or a screen reader, and does not scroll.
    expect(screen.getByText('Outside link')).toHaveAttribute('inert')
    expect(document.documentElement.style.overflow).toBe('hidden')

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(stage).toHaveAttribute('data-focus-mode', 'off')
    expect(stage).not.toHaveClass('fixed')
    expect(toggle).toHaveFocus()
    expect(frame()).toBe(before)
    expect(screen.getByText('Outside link')).not.toHaveAttribute('inert')
    expect(document.documentElement.style.overflow).toBe('')
  })

  it('leaves Focus mode on Esc pressed inside the package (forwarded by the bridge) and on the button', async () => {
    render(<ScormPlayer {...base} />)
    await startAttempt()
    const toggle = screen.getByRole('button', { name: 'Focus mode' })
    fireEvent.click(toggle)
    fromPackage({ type: 'escape' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    expect(toggle).toHaveFocus()

    fireEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Exit focus mode' }))
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
  })

  it('shows a save error in the header area and keeps the frame', async () => {
    mocks.commitLearningScormAttempt.mockResolvedValueOnce({ ok: false, error: 'We could not save your progress.' })
    render(<ScormPlayer {...base} />)
    await startAttempt()
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Save progress' })) })
    expect(screen.getByRole('alert')).toHaveTextContent('We could not save your progress.')
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(frame()).toBeInTheDocument()
  })

  it('opens a completed lesson in review mode with the frame, the Complete mark and Focus mode', () => {
    render(<ScormPlayer {...base} initiallyCompleted />)
    expect(frame()).toBeInTheDocument()
    expect(screen.getByText('Complete')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save progress' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Focus mode' })).toBeInTheDocument()
  })
})

import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PlayerTabs } from './player-tabs'

afterEach(() => {
  cleanup()
  window.history.replaceState(null, '', '/')
})

function renderTabs(initialTab?: 'lesson' | 'announcements') {
  return render(
    <PlayerTabs
      initialTab={initialTab}
      announcementCount={2}
      lesson={<div><p>Lesson content</p><video data-testid="lesson-video" /></div>}
      announcements={<p>Announcement list</p>}
    />,
  )
}

describe('PlayerTabs (learning round C)', () => {
  it('is an accessible tab list that opens on the lesson by default', () => {
    renderTabs()
    const list = screen.getByRole('tablist', { name: 'Course player' })
    const lesson = screen.getByRole('tab', { name: 'Lesson' })
    const announcements = screen.getByRole('tab', { name: /^Announcements\W*2\W*$/ })
    expect(list).toContainElement(lesson)
    expect(lesson).toHaveAttribute('aria-selected', 'true')
    expect(lesson).toHaveAttribute('tabIndex', '0')
    expect(announcements).toHaveAttribute('aria-selected', 'false')
    expect(announcements).toHaveAttribute('tabIndex', '-1')
    expect(screen.getByRole('tabpanel', { name: 'Lesson' })).toHaveTextContent('Lesson content')
    expect(screen.getByText('Announcement list')).not.toBeVisible()
  })

  it('switches with a click or the arrow keys, keeps the address in step and pauses the lesson media', () => {
    window.history.replaceState(null, '', '/learn/courses/fixture/learn?lesson=abc')
    renderTabs()
    const pause = vi.fn()
    Object.defineProperty(screen.getByTestId('lesson-video'), 'pause', { value: pause })

    fireEvent.click(screen.getByRole('tab', { name: /Announcements/ }))
    expect(screen.getByRole('tab', { name: /Announcements/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByText('Announcement list')).toBeVisible()
    expect(screen.getByText('Lesson content')).not.toBeVisible()
    expect(window.location.search).toBe('?lesson=abc&tab=announcements')
    expect(pause).toHaveBeenCalled()

    fireEvent.keyDown(screen.getByRole('tab', { name: /Announcements/ }), { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: 'Lesson' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Lesson' })).toHaveFocus()
    expect(window.location.search).toBe('?lesson=abc')

    fireEvent.keyDown(screen.getByRole('tab', { name: 'Lesson' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: /Announcements/ })).toHaveFocus()
  })

  it('opens on Announcements when the link asks for it', () => {
    renderTabs('announcements')
    expect(screen.getByRole('tab', { name: /Announcements/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel', { name: /Announcements/ })).toHaveTextContent('Announcement list')
  })
})

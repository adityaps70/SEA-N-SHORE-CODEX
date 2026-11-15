import { render } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CourseEditSession } from './course-edit-session'
import { installScrollKeeper, SCROLL_KEEPER_WINDOW_MS } from './scroll-keeper'

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

// Owner (15 Nov): in the course builder, typing or saving must never jump the page to the bottom.
const VIEWPORT = 800
const PAGE = 5000
let scrollY = 0
let stop: (() => void) | null = null
const scrollTo = vi.fn((_x: number, y: number) => { scrollY = y })

/** Where each element sits on the page (document y); the viewport rect follows the scroll position. */
function place(element: HTMLElement, top: number, height = 44) {
  element.getBoundingClientRect = () => ({ top: top - scrollY, bottom: top - scrollY + height, left: 0, right: 300, width: 300, height, x: 0, y: top - scrollY, toJSON: () => ({}) })
}

/** The browser (or a re-render) moves the page by itself. */
function pageJumpsTo(y: number) {
  scrollY = y
  window.dispatchEvent(new Event('scroll'))
}

function form() {
  document.body.innerHTML = '<input aria-label="Subtitle" /><button type="button">Save details</button><a href="#course-submit">Submit</a><p>text</p>'
  const input = document.querySelector('input')!
  const button = document.querySelector('button')!
  const link = document.querySelector('a')!
  place(input, 1200)
  place(button, 1300)
  return { input, button, link }
}

beforeEach(() => {
  scrollY = 1000
  scrollTo.mockClear()
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY })
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: VIEWPORT })
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: PAGE })
  window.scrollTo = scrollTo as unknown as typeof window.scrollTo
  stop = installScrollKeeper(window)
})

afterEach(() => {
  stop?.()
  stop = null
  vi.useRealTimers()
  document.body.innerHTML = ''
})

describe('course builder scroll keeper', () => {
  it('undoes a jump to the bottom while typing and keeps focus in the field', () => {
    const { input } = form()
    input.focus()
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    input.dispatchEvent(new Event('input', { bubbles: true }))
    pageJumpsTo(PAGE - VIEWPORT)
    expect(scrollTo).toHaveBeenLastCalledWith(expect.any(Number), 1000)
    expect(scrollY).toBe(1000)
    expect(document.activeElement).toBe(input)
  })

  it('undoes a jump after pressing Save (the server re-render) and puts focus back on the button', () => {
    const { button } = form()
    button.focus()
    button.click()
    // The save re-renders the page and focus drops to the page body.
    button.blur()
    pageJumpsTo(PAGE - VIEWPORT)
    expect(scrollY).toBe(1000)
    expect(document.activeElement).toBe(button)
  })

  it('undoes a leap to the bottom even when nothing is focused', () => {
    const { button } = form()
    button.click()
    button.blur()
    ;(document.activeElement as HTMLElement | null)?.blur?.()
    pageJumpsTo(PAGE - VIEWPORT)
    expect(scrollY).toBe(1000)
  })

  it('leaves small moves alone (the caret line, a growing field)', () => {
    const { input } = form()
    input.focus()
    input.dispatchEvent(new Event('input', { bubbles: true }))
    pageJumpsTo(1030)
    expect(scrollTo).not.toHaveBeenCalled()
    expect(scrollY).toBe(1030)
  })

  it('never undoes the person scrolling: wheel, touch, keys outside a field, section links', () => {
    const { input, link } = form()
    for (const scroll of [
      () => document.dispatchEvent(new Event('wheel', { bubbles: true })),
      () => document.dispatchEvent(new Event('touchstart', { bubbles: true })),
      () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true })),
      () => link.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
    ]) {
      scrollY = 1000
      input.focus()
      input.dispatchEvent(new Event('input', { bubbles: true }))
      scroll()
      pageJumpsTo(PAGE - VIEWPORT)
      expect(scrollY).toBe(PAGE - VIEWPORT)
    }
    expect(scrollTo).not.toHaveBeenCalled()
  })

  it('lapses a few seconds after the last keystroke or click', () => {
    vi.useFakeTimers()
    const { input } = form()
    input.focus()
    input.dispatchEvent(new Event('input', { bubbles: true }))
    vi.advanceTimersByTime(SCROLL_KEEPER_WINDOW_MS + 1)
    pageJumpsTo(PAGE - VIEWPORT)
    expect(scrollY).toBe(PAGE - VIEWPORT)
  })

  it('is on for every course editor page (CourseEditSession) and off once the page closes', () => {
    stop?.()
    stop = null
    const { unmount } = render(<CourseEditSession><input aria-label="Course title" /></CourseEditSession>)
    const input = document.querySelector<HTMLInputElement>('input[aria-label="Course title"]')!
    place(input, 1200)
    input.focus()
    input.dispatchEvent(new Event('input', { bubbles: true }))
    pageJumpsTo(PAGE - VIEWPORT)
    expect(scrollY).toBe(1000)

    unmount()
    scrollY = 1000
    input.dispatchEvent(new Event('input', { bubbles: true }))
    pageJumpsTo(PAGE - VIEWPORT)
    expect(scrollY).toBe(PAGE - VIEWPORT)
  })
})

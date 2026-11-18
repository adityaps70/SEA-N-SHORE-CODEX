import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetIntentPrefetchForTests } from '@/components/navigation/intent-link'
import { CurriculumAccordion, type CurriculumModuleView } from './curriculum-accordion'

const linkProps = vi.hoisted(() => [] as Array<{ prefetch: unknown; href: string }>)
vi.mock('next/link', () => ({
  default: ({ prefetch, href, children, ...props }: { prefetch?: unknown; href: string; children: ReactNode }) => {
    linkProps.push({ prefetch, href })
    return <a href={href} {...props}>{children}</a>
  },
}))

const modules: CurriculumModuleView[] = [
  { id: 'm1', title: 'Why SIRE 2.0 exists', done: 4, items: [
    { id: 'l1', title: 'Welcome', href: '/learn/courses/sire/learn?lesson=l1', meta: 'Video · 3 min', status: 'completed', statusLabel: 'Completed' },
    { id: 'l2', title: 'Reading', href: '/learn/courses/sire/learn?lesson=l2', meta: 'Article · 12 min read', status: 'available' },
  ] },
  { id: 'm2', title: 'The inspection lifecycle', done: 0, items: [
    { id: 'l3', title: 'Scheduling', href: '/learn/courses/sire/learn?lesson=l3', meta: 'Video · 5 min', status: 'locked', statusLabel: 'Locked' },
  ] },
]

function header(name: RegExp) {
  return screen.getByRole('button', { name })
}

describe('CurriculumAccordion (learning round E, E1)', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('opens only the module holding the current lesson, with its progress, and marks the current lesson', () => {
    render(<CurriculumAccordion modules={modules} currentItemId="l3" storageKey="sire" />)
    expect(header(/Module 1\s*Why SIRE 2.0 exists/)).toHaveAttribute('aria-expanded', 'false')
    const current = header(/Module 2\s*The inspection lifecycle/)
    expect(current).toHaveAttribute('aria-expanded', 'true')
    expect(current).toHaveTextContent('0/1 · 0%')
    expect(screen.getByRole('link', { current: 'page' })).toHaveAttribute('href', '/learn/courses/sire/learn?lesson=l3')
    // Screen readers hear "Locked" once, from the icon.
    expect(screen.getByRole('img', { name: 'Locked' })).toBeInTheDocument()
  })

  it('toggles a module, remembers it per course, and restores it on the next visit', () => {
    const { unmount } = render(<CurriculumAccordion modules={modules} currentItemId="l3" storageKey="sire" />)
    fireEvent.click(header(/Module 1/))
    expect(header(/Module 1/)).toHaveAttribute('aria-expanded', 'true')
    expect(JSON.parse(window.localStorage.getItem('sea-n-shore.learn.curriculum.sire')!)).toEqual(expect.arrayContaining(['m1', 'm2']))
    unmount()
    render(<CurriculumAccordion modules={modules} currentItemId="l3" storageKey="sire" />)
    expect(header(/Module 1/)).toHaveAttribute('aria-expanded', 'true')
  })

  it('expands and collapses every module at once', () => {
    render(<CurriculumAccordion modules={modules} currentItemId="l1" storageKey="sire" />)
    fireEvent.click(screen.getByRole('button', { name: 'Expand all' }))
    expect(header(/Module 1/)).toHaveAttribute('aria-expanded', 'true')
    expect(header(/Module 2/)).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Collapse all' }))
    expect(header(/Module 1/)).toHaveAttribute('aria-expanded', 'false')
    expect(header(/Module 2/)).toHaveAttribute('aria-expanded', 'false')
  })

  it('falls back to the current module when storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    render(<CurriculumAccordion modules={modules} currentItemId="l1" storageKey="sire" />)
    expect(header(/Module 1/)).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(header(/Module 2/))
    expect(header(/Module 2/)).toHaveAttribute('aria-expanded', 'true')
  })

  it('moves between headers and lessons with the arrow keys, and Home/End', () => {
    render(<CurriculumAccordion modules={modules} currentItemId="l1" storageKey={null} />)
    const first = header(/Module 1/)
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowDown' })
    expect(screen.getByRole('link', { name: /Welcome/ })).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'End' })
    expect(header(/Module 2/)).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Home' })
    expect(first).toHaveFocus()
  })

  it('renders an outline without links for the public page, with module summaries', () => {
    render(<CurriculumAccordion modules={[{ id: 'p1', title: 'Foundations', summary: '2 items · 15 min', items: [{ id: 'x', title: 'Intro', meta: 'Video · 5 min', status: 'locked' }] }]} />)
    const outline = header(/Module 1\s*Foundations/)
    expect(outline).toHaveTextContent('2 items · 15 min')
    expect(within(screen.getByRole('list', { name: 'Course curriculum' })).queryByRole('link')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Expand all' })).not.toBeInTheDocument()
  })
})

describe('CurriculumAccordion module labels (Round H, H7)', () => {
  afterEach(() => cleanup())

  it('shows a numbered section title once, without a second "Module N" label', () => {
    render(<CurriculumAccordion modules={[
      { id: 'n1', title: 'Module 1 · Team Working', items: [] },
      { id: 'n2', title: 'Bridge resource management', items: [] },
    ]} />)
    const first = screen.getByRole('button', { name: /Team Working/ })
    expect(first.textContent?.match(/Module 1/g)).toHaveLength(1)
    expect(screen.getByRole('button', { name: /Module 2\s*Bridge resource management/ })).toBeInTheDocument()
  })
})

// Owner (17 Nov): every visible lesson row was prefetched on load (about 20 RSC requests per lesson opened).
describe('CurriculumAccordion lesson links prefetch only on intent', () => {
  beforeEach(() => {
    window.localStorage.clear()
    resetIntentPrefetchForTests()
    linkProps.length = 0
  })
  afterEach(() => cleanup())

  it('prefetches no lesson on load, and one lesson when the learner hovers or taps it', () => {
    const prefetch = vi.fn()
    const router = { prefetch, push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }
    render(
      <AppRouterContext.Provider value={router as unknown as ComponentProps<typeof AppRouterContext.Provider>['value']}>
        <CurriculumAccordion modules={modules} currentItemId="l1" storageKey="sire" />
      </AppRouterContext.Provider>,
    )
    const rows = linkProps.filter((props) => props.href.includes('?lesson='))
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((props) => props.prefetch === false)).toBe(true)
    expect(prefetch).not.toHaveBeenCalled()

    fireEvent.mouseEnter(screen.getByRole('link', { name: /Reading/ }))
    expect(prefetch).toHaveBeenCalledTimes(1)
    expect(prefetch).toHaveBeenCalledWith('/learn/courses/sire/learn?lesson=l2')
  })
})

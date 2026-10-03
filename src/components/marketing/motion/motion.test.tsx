import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Enter, MotionRoot, Reveal, RotatingWords } from './index'

type ObserverRecord = { callback: IntersectionObserverCallback; observed: Element[]; options?: IntersectionObserverInit }
let observers: ObserverRecord[] = []

class FakeIntersectionObserver {
  record: ObserverRecord
  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.record = { callback, observed: [], options }
    observers.push(this.record)
  }
  observe(element: Element) { this.record.observed.push(element) }
  unobserve(element: Element) { this.record.observed = this.record.observed.filter((entry) => entry !== element) }
  disconnect() { this.record.observed = [] }
  takeRecords() { return [] }
}

const originals = {
  matchMedia: window.matchMedia,
  IntersectionObserver: window.IntersectionObserver,
  innerHeight: window.innerHeight,
}

function setGlobal(name: 'matchMedia' | 'IntersectionObserver' | 'innerHeight', value: unknown) {
  Object.defineProperty(window, name, { value, configurable: true, writable: true })
}

function stubMatchMedia({ reduce = false, fine = true } = {}) {
  setGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reduce : query.includes('fine') ? fine : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
}

function placeAt(element: Element, top: number, height = 100) {
  element.getBoundingClientRect = () => ({ top, bottom: top + height, left: 0, right: 100, width: 100, height, x: 0, y: top, toJSON() {} }) as DOMRect
}

beforeEach(() => {
  observers = []
})

afterEach(() => {
  cleanup()
  setGlobal('matchMedia', originals.matchMedia)
  setGlobal('IntersectionObserver', originals.IntersectionObserver)
  setGlobal('innerHeight', originals.innerHeight)
})

describe('Enter and Reveal', () => {
  it('render the requested element with motion data attributes and stagger variables', () => {
    render(
      <>
        <Enter as="h1" variant="pop" delay={3}>Hello</Enter>
        <Reveal as="li" delay={12}>Item</Reveal>
      </>,
    )
    const heading = screen.getByRole('heading', { name: 'Hello' })
    expect(heading).toHaveAttribute('data-enter', 'pop')
    expect(heading.style.getPropertyValue('--d')).toBe('3')
    const item = screen.getByText('Item')
    expect(item.tagName).toBe('LI')
    expect(item).toHaveAttribute('data-reveal', '')
    // Stagger is capped so long lists do not wait forever.
    expect(item.style.getPropertyValue('--i')).toBe('8')
  })
})

describe('MotionRoot', () => {
  it('leaves everything visible when IntersectionObserver is missing', () => {
    stubMatchMedia()
    setGlobal('IntersectionObserver', undefined)
    const { container } = render(<MotionRoot className="lp"><Reveal>Below</Reveal></MotionRoot>)
    expect((container.firstChild as HTMLElement).dataset.motion).toBe('off')
  })

  it('leaves everything visible when the visitor prefers reduced motion', () => {
    stubMatchMedia({ reduce: true })
    setGlobal('IntersectionObserver', FakeIntersectionObserver)
    const { container } = render(<MotionRoot className="lp"><Reveal>Below</Reveal></MotionRoot>)
    expect((container.firstChild as HTMLElement).dataset.motion).toBe('off')
    expect(observers).toHaveLength(0)
  })

  it('never hides what is already on screen and reveals the rest as it scrolls in', () => {
    stubMatchMedia()
    setGlobal('IntersectionObserver', FakeIntersectionObserver)
    setGlobal('innerHeight', 800)
    const originalRect = Element.prototype.getBoundingClientRect
    Element.prototype.getBoundingClientRect = function getRect(this: Element) {
      const top = this.textContent === 'Visible' ? 100 : 2000
      return { top, bottom: top + 100, left: 0, right: 100, width: 100, height: 100, x: 0, y: top, toJSON() {} } as DOMRect
    }

    try {
      const { container } = render(
        <MotionRoot className="lp">
          <Reveal>Visible</Reveal>
          <Reveal>Later</Reveal>
        </MotionRoot>,
      )
      const root = container.firstChild as HTMLElement
      expect(root.dataset.motion).toBe('on')

      const visible = screen.getByText('Visible')
      const later = screen.getByText('Later')
      expect(visible).toHaveClass('is-seen')
      expect(later).not.toHaveClass('is-seen')
      expect(observers[0].observed).toEqual([later])

      act(() => {
        observers[0].callback([{ isIntersecting: true, target: later } as unknown as IntersectionObserverEntry], {} as IntersectionObserver)
      })
      expect(later).toHaveClass('is-in')
      expect(observers[0].observed).toEqual([])
    } finally {
      Element.prototype.getBoundingClientRect = originalRect
    }
  })

  it('pulls buttons gently toward a fine pointer and lets go when it leaves', () => {
    stubMatchMedia()
    setGlobal('IntersectionObserver', FakeIntersectionObserver)
    const { container } = render(<MotionRoot className="lp"><a className="btn" href="/x">Go</a></MotionRoot>)
    const button = screen.getByRole('link', { name: 'Go' })
    placeAt(button, 0, 40)
    const root = container.firstChild as HTMLElement

    button.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientX: 100, clientY: 20 }))
    expect(button.style.translate).not.toBe('')
    root.dispatchEvent(new MouseEvent('pointerleave'))
    expect(button.style.translate).toBe('')
  })
})

describe('RotatingWords', () => {
  it('rotates the highlighted word and gives screen readers the whole list once', async () => {
    stubMatchMedia()
    render(<RotatingWords words={['seafarers', 'trainers', 'recruiters']} label="seafarers, trainers and recruiters" interval={30} />)

    expect(screen.getByText('seafarers, trainers and recruiters')).toHaveClass('sr-only')
    expect(screen.getByText('seafarers')).toHaveClass('rw', 'on')
    expect(screen.getByText('seafarers')).toHaveAttribute('aria-hidden', 'true')

    const words = ['seafarers', 'trainers', 'recruiters']
    await waitFor(() => expect(screen.getByText('seafarers')).not.toHaveClass('on'))
    // Exactly one word is shown, and the one before it is leaving.
    const current = words.filter((word) => screen.getByText(word).classList.contains('on'))
    expect(current).toHaveLength(1)
    const previous = words[(words.indexOf(current[0]) + words.length - 1) % words.length]
    expect(screen.getByText(previous)).toHaveClass('out')
    // It keeps cycling back to the start.
    await waitFor(() => expect(screen.getByText('seafarers')).toHaveClass('on'))
  })

  it('stays on the first word with reduced motion', async () => {
    stubMatchMedia({ reduce: true })
    render(<RotatingWords words={['seafarers', 'trainers']} label="seafarers and trainers" interval={10} />)
    await act(() => new Promise((resolve) => setTimeout(resolve, 60)))
    expect(screen.getByText('seafarers')).toHaveClass('on')
    expect(screen.getByText('trainers')).not.toHaveClass('on')
  })
})

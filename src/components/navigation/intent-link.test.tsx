import { fireEvent, render, screen } from '@testing-library/react'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { ComponentProps, ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IntentLink, intentPrefetchKey, resetIntentPrefetchForTests } from './intent-link'

const linkProps = vi.hoisted(() => [] as Array<Record<string, unknown>>)
vi.mock('next/link', () => ({
  default: ({ prefetch, href, children, ...props }: { prefetch?: unknown; href: string; children: ReactNode }) => {
    linkProps.push({ prefetch, href })
    return <a href={href} {...props}>{children}</a>
  },
}))

function withRouter(prefetch: (href: string) => void, node: ReactNode) {
  const router = { prefetch, push: vi.fn(), replace: vi.fn(), back: vi.fn(), forward: vi.fn(), refresh: vi.fn() }
  return <AppRouterContext.Provider value={router as unknown as ComponentProps<typeof AppRouterContext.Provider>['value']}>{node}</AppRouterContext.Provider>
}

describe('IntentLink', () => {
  beforeEach(() => {
    resetIntentPrefetchForTests()
    linkProps.length = 0
  })

  it('never prefetches on viewport, only on hover, focus or touch, and once per route per session', () => {
    const prefetch = vi.fn()
    render(withRouter(prefetch, <><IntentLink href="/jobs">Jobs</IntentLink><IntentLink href="/jobs">Jobs again</IntentLink></>))
    expect(linkProps.every((props) => props.prefetch === false)).toBe(true)
    expect(prefetch).not.toHaveBeenCalled()

    fireEvent.mouseEnter(screen.getByText('Jobs'))
    fireEvent.focus(screen.getByText('Jobs'))
    fireEvent.touchStart(screen.getByText('Jobs again'))
    expect(prefetch).toHaveBeenCalledTimes(1)
    expect(prefetch).toHaveBeenCalledWith('/jobs')
  })

  it('keeps an explicit prefetch choice and calls the caller handlers', () => {
    const prefetch = vi.fn()
    const onMouseEnter = vi.fn()
    render(withRouter(prefetch, <IntentLink href="/learn" prefetch onMouseEnter={onMouseEnter}>Learn</IntentLink>))
    expect(linkProps[0].prefetch).toBe(true)
    fireEvent.mouseEnter(screen.getByText('Learn'))
    expect(onMouseEnter).toHaveBeenCalled()
    expect(prefetch).not.toHaveBeenCalled()
  })

  it('renders without an app router (no prefetch)', () => {
    render(<IntentLink href="/home">Home</IntentLink>)
    expect(() => fireEvent.mouseEnter(screen.getByText('Home'))).not.toThrow()
  })

  it('only prefetches same-site paths, without the hash', () => {
    expect(intentPrefetchKey('/jobs/1#apply')).toBe('/jobs/1')
    expect(intentPrefetchKey('https://example.com')).toBeNull()
    expect(intentPrefetchKey('//example.com/x')).toBeNull()
    expect(intentPrefetchKey({ pathname: '/x' })).toBeNull()
  })
})

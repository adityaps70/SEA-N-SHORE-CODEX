import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import type { ComponentProps, ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { RelatedPolicies, TextLink } from '@/components/legal/legal-page'
import { NewsletterSignupForm } from '@/features/newsletter/components/newsletter-signup-form'
import { FooterLinkColumns } from './app-footer'
import { resetIntentPrefetchForTests } from './intent-link'

vi.mock('@/features/newsletter/actions', () => ({ subscribeToNewsletter: vi.fn() }))

const linkProps = vi.hoisted(() => [] as Array<{ prefetch?: unknown; href: string }>)
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

beforeEach(() => {
  resetIntentPrefetchForTests()
  linkProps.length = 0
})
afterEach(() => cleanup())

/** Every rendered link: no viewport prefetch, and hover, focus or touch fetch nothing either. */
function expectNoPrefetch(prefetch: ReturnType<typeof vi.fn>) {
  expect(linkProps.length).toBeGreaterThan(0)
  expect(linkProps.every((props) => props.prefetch === false)).toBe(true)
  for (const link of screen.getAllByRole('link')) {
    fireEvent.mouseEnter(link)
    fireEvent.focus(link)
    fireEvent.touchStart(link)
  }
  expect(prefetch).not.toHaveBeenCalled()
}

describe('footer and legal links never prefetch (Round P3)', () => {
  it.each([false, true])('footer columns (signed in: %s)', (signedIn) => {
    const prefetch = vi.fn()
    render(withRouter(prefetch, <FooterLinkColumns signedIn={signedIn} />))
    expect(linkProps.map((props) => props.href)).toEqual(expect.arrayContaining(['/privacy', '/terms']))
    expectNoPrefetch(prefetch)
  })

  it('the footer newsletter form privacy link', () => {
    const prefetch = vi.fn()
    render(withRouter(prefetch, <NewsletterSignupForm />))
    expect(linkProps.map((props) => props.href)).toContain('/privacy')
    expectNoPrefetch(prefetch)
  })

  it('related-policy rows and links inside policy text', () => {
    const prefetch = vi.fn()
    render(withRouter(prefetch, <>
      <RelatedPolicies links={[{ href: '/terms', label: 'Terms' }, { href: '/privacy', label: 'Privacy Policy' }]} />
      <TextLink href="/copyright">Copyright</TextLink>
    </>))
    expectNoPrefetch(prefetch)
  })
})

import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}))
vi.mock('@/components/brand/wordmark', () => ({ Wordmark: () => <span>Sea N Shore</span> }))
vi.mock('@/features/newsletter/components/newsletter-footer-signup', () => ({
  NewsletterFooterSignup: () => <form aria-label="Newsletter sign-up" />,
}))

import { SiteFooter } from './site-footer'

afterEach(() => cleanup())

// Round H (H6): PublicFooter became the one SiteFooter. The signed-out assertions are the old
// PublicFooter ones; signed-in status is now a prop instead of a session lookup.
describe('SiteFooter', () => {
  it('gives signed-out visitors the three link groups, social icons, the newsletter sign-up and the bottom line', () => {
    render(<SiteFooter signedIn={false} />)

    const nav = screen.getByRole('navigation', { name: 'Footer' })
    expect(within(nav).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Product', 'Company', 'Help & legal'])
    for (const [name, href] of [['About', '/about'], ['Jobs', '/jobs'], ['Learn', '/learn'], ['Events', '/events'], ['Community', '/community'], ['Help', '/help'], ['Contact us', '/contact'], ['Pricing', '/pricing'], ['Refunds & cancellation', '/refunds'], ['Shipping & delivery', '/shipping'], ['Privacy Policy', '/privacy'], ['Terms', '/terms'], ['Copyright & IP', '/copyright'], ['Newsletter', '/newsletter']]) {
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href)
    }
    expect(within(nav).queryByRole('link', { name: 'Your data & privacy' })).not.toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Newsletter sign-up' })).toBeInTheDocument()
    expect(within(nav).getAllByRole('link')).toHaveLength(15)

    const social = screen.getByRole('list', { name: 'Sea N Shore on social media' })
    const socialLinks = within(social).getAllByRole('link')
    expect(socialLinks.map((link) => link.getAttribute('aria-label'))).toEqual(['Instagram (opens in a new tab)', 'Facebook (opens in a new tab)', 'X (opens in a new tab)'])
    for (const link of socialLinks) {
      expect(link).toHaveAttribute('target', '_blank')
      expect(link).toHaveAttribute('rel', 'noopener noreferrer')
      expect(link.querySelector('svg')).toBeInTheDocument()
    }

    expect(screen.getByText(`© ${new Date().getFullYear()} Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai, India`)).toBeInTheDocument()
    expect(screen.queryByText(/All rights reserved/)).not.toBeInTheDocument()
    expect(screen.queryByText(/is operated by/)).not.toBeInTheDocument()
    expect(screen.queryByText(/User-generated content/)).not.toBeInTheDocument()
  })

  it('adds the data and privacy controls link for signed-in members', () => {
    render(<SiteFooter signedIn />)
    expect(screen.getByRole('link', { name: 'Your data & privacy' })).toHaveAttribute('href', '/settings#your-data')
  })

  it('is one "Site footer" landmark holding the newsletter box, for visitors and members alike', () => {
    for (const signedIn of [false, true]) {
      const { unmount } = render(<SiteFooter signedIn={signedIn} />)
      const footers = screen.getAllByRole('contentinfo')
      expect(footers).toHaveLength(1)
      expect(footers[0]).toHaveAttribute('aria-label', 'Site footer')
      expect(footers[0]).toHaveAttribute('data-app-footer', 'site')
      expect(within(footers[0]).getAllByRole('form', { name: 'Newsletter sign-up' })).toHaveLength(1)
      unmount()
    }
  })

  it('hides at the rail breakpoint on pages with a rail footer, for visitors and members alike', () => {
    for (const signedIn of [false, true]) {
      const { container, unmount } = render(<SiteFooter signedIn={signedIn} />)
      expect(container.querySelector('footer')).toHaveClass('lg:group-has-data-[rail-footer=lg]/shell:hidden', 'xl:group-has-data-[rail-footer=xl]/shell:hidden')
      unmount()
    }
  })

  it('shows on phones for signed-out visitors (no side drawer) and not for members (links in the drawer)', () => {
    const { container, unmount } = render(<SiteFooter signedIn={false} />)
    expect(container.querySelector('footer')).not.toHaveClass('max-md:hidden')
    unmount()
    const member = render(<SiteFooter signedIn />)
    expect(member.container.querySelector('footer')).toHaveClass('max-md:hidden')
  })
})

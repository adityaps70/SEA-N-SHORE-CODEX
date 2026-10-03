import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ viewer: null as null | { id: string } }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a href={href} {...props}>{children}</a>,
}))
vi.mock('@/components/brand/wordmark', () => ({ Wordmark: () => <span>Sea N Shore</span> }))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: async () => mocks.viewer }))
vi.mock('@/features/newsletter/components/newsletter-footer-signup', () => ({
  NewsletterFooterSignup: () => <form aria-label="Newsletter sign-up" />,
}))

import { PublicFooter } from './public-footer'

afterEach(() => cleanup())

describe('PublicFooter', () => {
  it('gives signed-out visitors the three link groups, social icons, the newsletter sign-up and the bottom line', async () => {
    mocks.viewer = null
    render(await PublicFooter())

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

  it('adds the data and privacy controls link for signed-in members', async () => {
    mocks.viewer = { id: 'p1' }
    render(await PublicFooter())
    expect(screen.getByRole('link', { name: 'Your data & privacy' })).toHaveAttribute('href', '/settings#your-data')
  })
})

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
  it('gives signed-out visitors the same grouped link set, the newsletter sign-up and the copyright line', async () => {
    mocks.viewer = null
    render(await PublicFooter())

    const nav = screen.getByRole('navigation', { name: 'Footer' })
    for (const [name, href] of [['About', '/about'], ['Jobs', '/jobs'], ['Learn', '/learn'], ['Events', '/events'], ['Community', '/community'], ['Contact & support', '/help'], ['Privacy Policy', '/privacy'], ['Terms', '/terms'], ['Copyright & IP', '/copyright'], ['Newsletter', '/newsletter']]) {
      expect(within(nav).getByRole('link', { name })).toHaveAttribute('href', href)
    }
    expect(within(nav).queryByRole('link', { name: 'Your data & privacy' })).not.toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Newsletter sign-up' })).toBeInTheDocument()
    expect(screen.getByText(/All rights reserved/)).toBeInTheDocument()
  })

  it('adds the data and privacy controls link for signed-in members', async () => {
    mocks.viewer = { id: 'p1' }
    render(await PublicFooter())
    expect(screen.getByRole('link', { name: 'Your data & privacy' })).toHaveAttribute('href', '/settings#your-data')
  })
})

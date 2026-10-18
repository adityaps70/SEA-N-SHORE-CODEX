import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getVerifiedUser: vi.fn() }))

vi.mock('next/navigation', () => ({
  usePathname: () => '/jobs',
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), prefetch: vi.fn() }),
}))
vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/auth/actions', () => ({ signOut: vi.fn() }))
vi.mock('@/features/newsletter/components/newsletter-footer-signup', () => ({
  NewsletterFooterSignup: () => <form aria-label="Newsletter sign-up" />,
}))

import AccessibilityPage from './(marketing)/accessibility/page'
import PublicLayout from './(public)/layout'
import { MainLandmark } from '@/components/layout/main-landmark'
import { BUSINESS } from '@/config/business'

afterEach(() => cleanup())

describe('signed-out public shell (Round H, H8)', () => {
  it('starts with "Skip to content" and wraps the page in exactly one main landmark', async () => {
    mocks.getVerifiedUser.mockResolvedValue(null)
    const { container } = render(await PublicLayout({ children: <MainLandmark className="job-box">Jobs page</MainLandmark> }))
    expect(container.querySelectorAll('main')).toHaveLength(1)
    expect(container.querySelector('main')).toHaveAttribute('id', 'main-content')
    expect(container.querySelector('main')).toHaveTextContent('Jobs page')
    const firstFocusable = container.querySelector('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])')
    expect(firstFocusable).toHaveTextContent('Skip to content')
  })
})

describe('accessibility statement (Round H, H8)', () => {
  it('states the WCAG 2.1 AA target, what was done, the known gaps, how to report and when it was reviewed', () => {
    render(<AccessibilityPage />)
    expect(screen.getByRole('heading', { level: 1, name: 'Accessibility statement' })).toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('id', 'main-content')
    for (const name of ['Our target', 'What we have done', 'Known gaps', 'Report a problem']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeInTheDocument()
    }
    expect(screen.getByText(/at level AA across the website/)).toBeInTheDocument()
    expect(screen.getByText(/We do not claim full conformance yet/)).toBeInTheDocument()
    expect(screen.getByText('Last updated: October 2026')).toBeInTheDocument()

    const gaps = screen.getByRole('region', { name: 'Known gaps' })
    for (const gap of ['Videos.', 'PDF documents.', 'Images without descriptions.']) expect(within(gaps).getByText(gap)).toBeInTheDocument()

    const report = screen.getByRole('region', { name: 'Report a problem' })
    expect(within(report).getByRole('link', { name: 'contact form' })).toHaveAttribute('href', '/contact#contact-form')
    expect(within(report).getByRole('link', { name: BUSINESS.email })).toHaveAttribute('href', `mailto:${BUSINESS.email}`)
  })
})

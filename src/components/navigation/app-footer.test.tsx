import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AppFooter } from './app-footer'
import { RailFooter } from './rail-footer'

afterEach(() => cleanup())

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

describe('AppFooter (compact end-of-content footer)', () => {
  it('shows copyright wording and the full trust, legal and navigation link set', () => {
    render(<AppFooter />)

    expect(screen.getByText(/all rights reserved/i)).toBeVisible()
    const nav = screen.getByRole('navigation', { name: 'Footer' })
    expect(within(nav).getByRole('link', { name: 'Copyright & IP' })).toHaveAttribute('href', '/copyright')
    expect(within(nav).getByRole('link', { name: 'Terms' })).toHaveAttribute('href', '/terms')
    expect(within(nav).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
    expect(within(nav).getByRole('link', { name: 'Help' })).toHaveAttribute('href', '/help')
    expect(within(nav).getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact')
    expect(within(nav).getByRole('link', { name: 'Pricing' })).toHaveAttribute('href', '/pricing')
    expect(within(nav).getByRole('link', { name: 'Refunds & cancellation' })).toHaveAttribute('href', '/refunds')
    expect(within(nav).getByRole('link', { name: 'Shipping & delivery' })).toHaveAttribute('href', '/shipping')
    expect(within(nav).getByRole('link', { name: 'Your data & privacy' })).toHaveAttribute('href', '/settings#your-data')
    expect(within(nav).getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/jobs')
    expect(screen.getByText('Sea N Shore is operated by Beaufort Marine Services LLP · Navi Mumbai, India')).toBeVisible()
    expect(screen.getByRole('link', { name: /Instagram/ })).toHaveAttribute('href', 'https://www.instagram.com/seaandshore.in')
  })

  it('hides itself at the rail breakpoint when the page renders a rail footer', () => {
    const { container } = render(<AppFooter />)
    const footer = container.querySelector('footer')
    expect(footer).toHaveClass('lg:group-has-data-[rail-footer=lg]/shell:hidden', 'xl:group-has-data-[rail-footer=xl]/shell:hidden')
  })
})

describe('RailFooter (LinkedIn-style right-rail footer)', () => {
  it('renders the compact link cloud and copyright line, only from its breakpoint up', () => {
    const { container } = render(<RailFooter visibleFrom="lg" />)
    const footer = container.querySelector('footer')
    expect(footer).toHaveAttribute('data-rail-footer', 'lg')
    expect(footer).toHaveClass('hidden', 'lg:block', 'sticky', 'bottom-0')
    expect(within(footer as HTMLElement).getByRole('link', { name: 'About' })).toHaveAttribute('href', '/about')
    expect(within(footer as HTMLElement).getByText('Sea N Shore')).toBeInTheDocument()
    expect(within(footer as HTMLElement).getByRole('link', { name: 'Refunds & cancellation' })).toHaveAttribute('href', '/refunds')
    expect(within(footer as HTMLElement).getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact')
    expect(within(footer as HTMLElement).getByText('Sea N Shore is operated by Beaufort Marine Services LLP · Navi Mumbai, India')).toBeInTheDocument()
  })

  it('defaults to the xl breakpoint used by the home feed rail', () => {
    const { container } = render(<RailFooter />)
    expect(container.querySelector('footer')).toHaveAttribute('data-rail-footer', 'xl')
    expect(container.querySelector('footer')).toHaveClass('xl:block')
  })

  it('is rendered at the end of every right rail, with the breakpoint of that rail', () => {
    expect(source('src/features/feed/components/feed-layout.tsx')).toContain('<RailFooter visibleFrom="xl" />')
    expect(source('src/app/(app)/activities/page.tsx')).toContain('<RailFooter visibleFrom="xl" />')
    expect(source('src/app/(app)/profile/page.tsx')).toContain('<RailFooter visibleFrom="lg" />')
    expect(source('src/app/(public)/people/[slug]/page.tsx')).toContain('<RailFooter visibleFrom="lg" />')
    expect(source('src/app/(app)/jobs/[id]/page.tsx')).toContain('<RailFooter visibleFrom="lg" />')
  })

  it('keeps the compact footer in both signed-in shells, which provide the group/shell hook', () => {
    for (const layout of ['src/app/(app)/layout.tsx', 'src/app/(public)/layout.tsx']) {
      const text = source(layout)
      expect(text).toContain('group/shell')
      expect(text).toContain('<AppFooter />')
      // Clears the fixed mobile bottom navigation, including the iPhone home indicator.
      expect(text).toContain('pb-[calc(4.5rem+env(safe-area-inset-bottom))]')
    }
  })
})

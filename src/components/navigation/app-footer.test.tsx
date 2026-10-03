import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { AppFooter, FOOTER_LINK_GROUPS, FooterSocialIcons, footerBottomLine, footerLinks } from './app-footer'
import { RailFooter, railKeyLinks } from './rail-footer'

afterEach(() => cleanup())

function source(path: string) {
  return readFileSync(join(process.cwd(), path), 'utf8')
}

const ALL_LINKS = footerLinks({ signedIn: true })
const BOTTOM_LINE = `© ${new Date().getFullYear()} Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai, India`

function expectSocialIcons(root: HTMLElement) {
  const social = within(root).getByRole('list', { name: 'Sea N Shore on social media' })
  const links = within(social).getAllByRole('link')
  expect(links.map((link) => link.getAttribute('aria-label'))).toEqual([
    'Instagram (opens in a new tab)',
    'Facebook (opens in a new tab)',
    'X (opens in a new tab)',
  ])
  expect(links.map((link) => link.getAttribute('href'))).toEqual([
    'https://www.instagram.com/seaandshore.in',
    'https://www.facebook.com/seaandshore.in',
    'https://x.com/inseaandshore',
  ])
  for (const link of links) {
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener noreferrer')
    // Icons, not text: the only name comes from the aria-label.
    expect(link.textContent).toBe('')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
  }
}

describe('footer building blocks', () => {
  it('groups the links as Product, Company and Help & legal', () => {
    expect(FOOTER_LINK_GROUPS.map((group) => group.title)).toEqual(['Product', 'Company', 'Help & legal'])
    expect(FOOTER_LINK_GROUPS.map((group) => group.links.map((link) => link.label))).toEqual([
      ['Jobs', 'Learn', 'Events', 'Community', 'Pricing'],
      ['About', 'Contact us', 'Newsletter'],
      ['Help', 'Accessibility', 'Terms', 'Privacy Policy', 'Refunds & cancellation', 'Shipping & delivery', 'Copyright & IP', 'Your data & privacy'],
    ])
  })

  it('builds the one quiet bottom line from the business details', () => {
    expect(footerBottomLine(2026)).toBe('© 2026 Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai, India')
    expect(footerBottomLine()).toBe(BOTTOM_LINE)
  })

  it('renders the configured social profiles as named icon links opening in a new tab', () => {
    const { container } = render(<FooterSocialIcons />)
    expectSocialIcons(container)
  })
})

describe('AppFooter (compact end-of-content footer)', () => {
  it('shows the three link groups with every footer link, the social icons and the bottom line', () => {
    render(<AppFooter />)

    const nav = screen.getByRole('navigation', { name: 'Footer' })
    expect(within(nav).getAllByRole('heading').map((heading) => heading.textContent)).toEqual(['Product', 'Company', 'Help & legal'])
    for (const link of ALL_LINKS) {
      expect(within(nav).getByRole('link', { name: link.label })).toHaveAttribute('href', link.href)
    }
    expect(within(nav).getAllByRole('link')).toHaveLength(ALL_LINKS.length)
    expect(within(nav).getByRole('link', { name: 'Your data & privacy' })).toHaveAttribute('href', '/settings#your-data')

    expectSocialIcons(screen.getByRole('contentinfo'))
    expect(screen.getByText(BOTTOM_LINE)).toBeVisible()
    expect(screen.queryByText(/all rights reserved/i)).not.toBeInTheDocument()
    expect(screen.queryByText(/is operated by/)).not.toBeInTheDocument()
    expect(screen.queryByText(/User-generated content/)).not.toBeInTheDocument()
  })

  it('hides itself at the rail breakpoint when the page renders a rail footer', () => {
    const { container } = render(<AppFooter />)
    const footer = container.querySelector('footer')
    expect(footer).toHaveClass('lg:group-has-data-[rail-footer=lg]/shell:hidden', 'xl:group-has-data-[rail-footer=xl]/shell:hidden')
  })

  it('is hidden on phones, where the same links sit at the bottom of the side drawer', () => {
    const { container } = render(<AppFooter />)
    expect(container.querySelector('footer')).toHaveClass('max-md:hidden')
    expect(source('src/components/navigation/side-drawer.tsx')).toContain('drawerFooterLinks()')
    expect(source('src/components/navigation/side-drawer.tsx')).toContain('footerBottomLine()')
    expect(source('src/components/navigation/side-drawer.tsx')).toContain('<FooterSocialIcons')
  })
})

describe('RailFooter (compact right-rail footer)', () => {
  it('shows a few key links, then every link behind a native "More" disclosure, social icons and the bottom line', () => {
    const { container } = render(<RailFooter visibleFrom="lg" />)
    const footer = container.querySelector('footer') as HTMLElement
    expect(footer).toHaveAttribute('data-rail-footer', 'lg')
    expect(footer).toHaveClass('hidden', 'lg:block', 'sticky', 'bottom-0')
    expect(footer).not.toHaveClass('bg-mist-50')

    expect(railKeyLinks().map((link) => link.label)).toEqual(['Help', 'Terms', 'Privacy Policy', 'Contact us', 'Pricing'])
    const nav = within(footer).getByRole('navigation', { name: 'Footer' })
    const keyList = nav.querySelector('ul') as HTMLElement
    expect(within(keyList).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/help', '/terms', '/privacy', '/contact', '/pricing'])

    const more = nav.querySelector('details') as HTMLElement
    expect(more).not.toHaveAttribute('open')
    const summary = more.querySelector('summary') as HTMLElement
    expect(summary).toHaveTextContent('More')
    expect(summary.querySelector('svg')).toHaveClass('group-open/more:rotate-180')
    expect(within(more).getAllByRole('heading', { hidden: true }).map((heading) => heading.textContent)).toEqual(['Product', 'Company', 'Help & legal'])
    for (const link of ALL_LINKS) {
      expect(within(more).getByRole('link', { name: link.label, hidden: true })).toHaveAttribute('href', link.href)
    }

    expectSocialIcons(footer)
    expect(within(footer).getByText(BOTTOM_LINE)).toBeInTheDocument()
    expect(within(footer).queryByText(/is operated by/)).not.toBeInTheDocument()
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
      // Clears the fixed mobile bottom navigation, including the iPhone home indicator,
      // and drops that padding on full-screen routes, where the tab bar is not shown.
      expect(text).toContain('pb-[calc(4.5rem+env(safe-area-inset-bottom))]')
      expect(text).toContain('has-[[data-phone-tabbar=off]]:pb-0')
      // Both shells pass the same chrome props (so organizations reach the account menu everywhere).
      for (const helper of ['appHeaderProps(chrome)', 'mobileAppHeaderProps(chrome)', 'mobileNavProps(chrome)']) {
        expect(text).toContain(helper)
      }
    }
    // Phones: 16px page padding all round; md and wider keep py-6.
    expect(source('src/app/(app)/layout.tsx')).toContain('px-4 py-4 md:py-6')
  })
})

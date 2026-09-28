import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FOOTER_LINK_GROUPS, footerLinks } from './app-footer'
import { CREATE_SHEET_GROUPS } from './create-sheet'
import { drawerFooterLinks } from './side-drawer'
import { SOCIAL_LINKS, configuredSocialLinks } from './social-links'

const appDir = join(process.cwd(), 'src/app')

function pageRoutes(dir = appDir): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) return pageRoutes(path)
    if (!/^page\.(tsx|ts|jsx|js|mdx)$/.test(entry)) return []
    const segments = relative(appDir, dir)
      .split(sep)
      .filter(Boolean)
      .filter((segment) => !/^\(.*\)$/.test(segment) && !segment.startsWith('@'))
    return [`/${segments.join('/')}`]
  })
}

const routes = pageRoutes()

function resolves(href: string) {
  const path = href.split('#')[0].split('?')[0] || '/'
  return routes.some((route) => {
    const pattern = route
      .split('/')
      .map((segment) => (segment.startsWith('[') ? '[^/]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
      .join('/')
    return new RegExp(`^${pattern || '/'}$`).test(path)
  })
}

describe('footer links', () => {
  it('points every footer link at a page that exists in src/app', () => {
    const hrefs = FOOTER_LINK_GROUPS.flatMap((group) => group.links.map((link) => link.href))
    const missing = hrefs.filter((href) => !resolves(href))
    expect(missing).toEqual([])
  })

  it('covers the required destinations without duplicates', () => {
    const links = footerLinks({ signedIn: true })
    const hrefs = links.map((link) => link.href)
    expect(new Set(hrefs).size).toBe(hrefs.length)
    expect(new Set(links.map((link) => link.label)).size).toBe(links.length)
    for (const href of ['/about', '/jobs', '/learn', '/events', '/community', '/help', '/privacy', '/terms', '/copyright', '/newsletter', '/settings#your-data', '/contact', '/pricing', '/refunds', '/shipping']) {
      expect(hrefs).toContain(href)
    }
  })

  it('links the payment-gateway policy pages for everyone, signed in or not', () => {
    for (const signedIn of [true, false]) {
      const links = footerLinks({ signedIn })
      const byLabel = (label: string) => links.find((link) => link.label === label)?.href
      expect(byLabel('Contact us')).toBe('/contact')
      expect(byLabel('Pricing')).toBe('/pricing')
      expect(byLabel('Refunds & cancellation')).toBe('/refunds')
      expect(byLabel('Shipping & delivery')).toBe('/shipping')
      expect(byLabel('Terms')).toBe('/terms')
      expect(byLabel('Privacy Policy')).toBe('/privacy')
    }
  })

  it('sends Help to /help and data controls to the Settings data section', () => {
    const links = footerLinks({ signedIn: true })
    expect(links.find((link) => link.label === 'Help')?.href).toBe('/help')
    const data = links.find((link) => link.label === 'Your data & privacy')
    expect(data?.href).toBe('/settings#your-data')
    expect(readFileSync(join(appDir, '(app)/settings/page.tsx'), 'utf8')).toContain('id="your-data"')
  })

  it('hides member-only links from signed-out visitors', () => {
    expect(footerLinks({ signedIn: false }).map((link) => link.href)).not.toContain('/settings#your-data')
  })

  it('renders only the configured official social profiles, never empty or invalid ones', () => {
    expect(SOCIAL_LINKS.linkedin).toBe('')
    expect(configuredSocialLinks()).toEqual([
      { key: 'instagram', href: 'https://www.instagram.com/seaandshore.in', label: 'Instagram' },
      { key: 'facebook', href: 'https://www.facebook.com/seaandshore.in', label: 'Facebook' },
      { key: 'x', href: 'https://x.com/inseaandshore', label: 'X' },
    ])
    expect(configuredSocialLinks({ linkedin: 'https://www.linkedin.com/company/example', instagram: 'not-a-url', youtube: '', facebook: '', x: '' }))
      .toEqual([{ key: 'linkedin', href: 'https://www.linkedin.com/company/example', label: 'LinkedIn' }])
  })

  it('gives the phone side drawer every footer link that has no row of its own in the drawer', () => {
    expect(drawerFooterLinks().map((link) => link.label)).toEqual([
      'About', 'Pricing', 'Contact us', 'Newsletter', 'Accessibility',
      'Terms', 'Privacy Policy', 'Refunds & cancellation', 'Shipping & delivery', 'Copyright & IP', 'Your data & privacy',
    ])
  })

  it('points every phone drawer row, footer link and Create sheet entry at a page that exists', () => {
    const drawerSource = readFileSync(join(process.cwd(), 'src/components/navigation/side-drawer.tsx'), 'utf8')
    const drawerHrefs = [...drawerSource.matchAll(/href="([^"]+)"/g)].map((match) => match[1])
    expect(drawerHrefs.length).toBeGreaterThan(10)
    const hrefs = [
      ...drawerHrefs,
      ...drawerFooterLinks().map((link) => link.href),
      ...CREATE_SHEET_GROUPS.flat().map((item) => item.href),
    ]
    expect(hrefs.filter((href) => !resolves(href))).toEqual([])
  })
})

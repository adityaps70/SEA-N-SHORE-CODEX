import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { describe, expect, it } from 'vitest'
import { FOOTER_LINK_GROUPS, footerLinks } from './app-footer'
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
    for (const href of ['/about', '/jobs', '/learn', '/events', '/community', '/help', '/privacy', '/terms', '/copyright', '/newsletter', '/settings#your-data']) {
      expect(hrefs).toContain(href)
    }
  })

  it('sends Contact & support to /help and data controls to the Settings data section', () => {
    const links = footerLinks({ signedIn: true })
    expect(links.find((link) => link.label === 'Contact & support')?.href).toBe('/help')
    const data = links.find((link) => link.label === 'Your data & privacy')
    expect(data?.href).toBe('/settings#your-data')
    expect(readFileSync(join(appDir, '(app)/settings/page.tsx'), 'utf8')).toContain('id="your-data"')
  })

  it('hides member-only links from signed-out visitors', () => {
    expect(footerLinks({ signedIn: false }).map((link) => link.href)).not.toContain('/settings#your-data')
  })

  it('renders no social links until real URLs are configured', () => {
    expect(Object.values(SOCIAL_LINKS).every((value) => value === '')).toBe(true)
    expect(configuredSocialLinks()).toEqual([])
    expect(configuredSocialLinks({ linkedin: 'https://www.linkedin.com/company/example', instagram: 'not-a-url', youtube: '', facebook: '', x: '' }))
      .toEqual([{ key: 'linkedin', href: 'https://www.linkedin.com/company/example', label: 'LinkedIn' }])
  })
})

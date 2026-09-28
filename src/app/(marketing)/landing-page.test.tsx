import fs from 'node:fs'
import path from 'node:path'
import { cleanup, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getVerifiedUser: vi.fn(),
  loadPublicPlanPrices: vi.fn(),
  googleEnabled: false,
}))

vi.mock('@/features/auth/queries', () => ({ getVerifiedUser: mocks.getVerifiedUser }))
vi.mock('@/features/billing/public-prices', () => ({ loadPublicPlanPrices: mocks.loadPublicPlanPrices }))
vi.mock('@/lib/env', () => ({
  getCognitoEnvironment: () => ({ AWS_COGNITO_GOOGLE_ENABLED: mocks.googleEnabled }),
}))

import Home, { metadata } from './page'

const SEEDED_PRICES = [
  { planCode: 'creator_pro', interval: 'month', amountMinor: 10_000, currency: 'INR', active: true },
  { planCode: 'creator_pro', interval: 'year', amountMinor: 100_000, currency: 'INR', active: true },
  { planCode: 'organization_pro', interval: 'month', amountMinor: 200_000, currency: 'INR', active: true },
  { planCode: 'organization_pro', interval: 'year', amountMinor: 2_000_000, currency: 'INR', active: true },
]

async function renderHome() {
  return render(await Home())
}

beforeEach(() => {
  mocks.getVerifiedUser.mockResolvedValue(null)
  mocks.loadPublicPlanPrices.mockResolvedValue({ prices: SEEDED_PRICES, available: true })
  mocks.googleEnabled = false
})

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const SECTION_IDS = ['jobs', 'passport', 'learn', 'events', 'feed', 'organizations', 'pricing'] as const

describe('public landing page', () => {
  it('leads with the approved headline and the section headings in order', async () => {
    await renderHome()

    const h1 = screen.getByRole('heading', { level: 1 })
    expect(h1).toHaveTextContent('Welcome to the global community for')
    expect(h1).toHaveTextContent('seafarers, shore staff, recruiters, trainers and ship managers')

    const h2s = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)
    expect(h2s).toEqual([
      'One free account. Everything your maritime career needs.',
      'Know your fit before you apply.',
      'A profile recruiters read in 10 seconds.',
      'Courses with certificates you can show.',
      'Webinars, workshops and port meetups.',
      'Where the industry talks shop.',
      'Whether you’re on the bridge or behind the desk.',
      'Create your organization’s page. Hire, post and teach from it.',
      'Backed by people who already run ships and crews.',
      'Free to join. Pay only when you publish or hire.',
      'Frequently asked questions',
      'Your next contract, course or crew starts here.',
    ])
  })

  it('offers sign-in like LinkedIn, pointing at the real auth routes', async () => {
    mocks.googleEnabled = true
    await renderHome()

    const signIn = screen.getByRole('group', { name: 'Sign in to Sea N Shore' })
    expect(within(signIn).getByRole('link', { name: /Continue with Google/ })).toHaveAttribute('href', '/auth/google/start?intent=sign-in')
    expect(within(signIn).getByRole('link', { name: /Continue with mobile number/ })).toHaveAttribute('href', '/auth/phone?intent=sign-in')
    expect(within(signIn).getByRole('link', { name: /Sign in with email/ })).toHaveAttribute('href', '/auth/sign-in')
    expect(within(signIn).getByRole('link', { name: /Join now — it’s free/ })).toHaveAttribute('href', '/auth/sign-up')
    expect(within(signIn).getByRole('link', { name: 'User Agreement' })).toHaveAttribute('href', '/terms')
    expect(within(signIn).getByRole('link', { name: 'Privacy Policy' })).toHaveAttribute('href', '/privacy')
    expect(within(signIn).getByRole('link', { name: 'Refund Policy' })).toHaveAttribute('href', '/refunds')

    const header = screen.getByRole('banner')
    expect(within(header).getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/auth/sign-in')
    expect(within(header).getByRole('link', { name: 'Join now' })).toHaveAttribute('href', '/auth/sign-up')
  })

  it('hides "Continue with Google" when Google sign-in is switched off', async () => {
    mocks.googleEnabled = false
    await renderHome()

    expect(screen.queryByRole('link', { name: /Continue with Google/ })).not.toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Continue with mobile number/ })).toBeInTheDocument()
    expect(screen.queryByText(/Google account/)).not.toBeInTheDocument()
  })

  it('shows signed-in visitors a way back into the app instead of sign-in buttons', async () => {
    mocks.getVerifiedUser.mockResolvedValue({ id: 'user-1' })
    await renderHome()

    expect(screen.queryByRole('link', { name: /Sign in with email/ })).not.toBeInTheDocument()
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/home')
    expect(within(header).getByRole('link', { name: 'My Profile' })).toHaveAttribute('href', '/profile')
    expect(screen.getAllByRole('link', { name: 'Go to Home' })[0]).toHaveAttribute('href', '/home')
  })

  it('still renders for an anonymous visitor when auth resolution fails', async () => {
    mocks.getVerifiedUser.mockRejectedValue(new Error('cognito down'))
    await renderHome()
    expect(screen.getByRole('link', { name: /Sign in with email/ })).toBeInTheDocument()
  })

  it('has every anchored section and header navigation that points to it', async () => {
    const { container } = await renderHome()

    for (const id of SECTION_IDS) {
      expect(container.querySelector(`section#${id}`), `section #${id}`).not.toBeNull()
    }
    for (const name of ['Main', 'Sections']) {
      const nav = screen.getByRole('navigation', { name })
      const hrefs = within(nav).getAllByRole('link').map((link) => link.getAttribute('href'))
      expect(hrefs).toEqual(SECTION_IDS.map((id) => `#${id}`))
    }
    expect(within(screen.getByRole('navigation', { name: 'Main' })).getByRole('link', { name: 'For companies' })).toHaveAttribute('href', '#organizations')
  })

  it('links feature calls to action to real pages', async () => {
    await renderHome()

    expect(screen.getByRole('link', { name: /Browse jobs/ })).toHaveAttribute('href', '/jobs')
    expect(screen.getByRole('link', { name: /Explore courses/ })).toHaveAttribute('href', '/learn')
    expect(screen.getByRole('link', { name: /See upcoming events/ })).toHaveAttribute('href', '/events')
    expect(screen.getByRole('link', { name: /Create your free Passport/ })).toHaveAttribute('href', '/auth/sign-up')
    expect(screen.getByRole('link', { name: 'Create your organization page' })).toHaveAttribute('href', '/organizations?register=1#update-application')
    expect(screen.getByRole('link', { name: 'See Organization Pro' })).toHaveAttribute('href', '/pricing')
    expect(screen.getByRole('link', { name: 'Join Sea N Shore free' })).toHaveAttribute('href', '/auth/sign-up')
  })

  it('shows plan prices from the price list', async () => {
    await renderHome()
    const pricing = document.getElementById('pricing') as HTMLElement
    expect(within(pricing).getByText('₹100')).toBeInTheDocument()
    expect(within(pricing).getByText('or ₹1,000 a year')).toBeInTheDocument()
    expect(within(pricing).getByText('₹2,000')).toBeInTheDocument()
    expect(within(pricing).getByText('or ₹20,000 a year')).toBeInTheDocument()
  })

  it('falls back to "See pricing" when prices cannot be loaded', async () => {
    mocks.loadPublicPlanPrices.mockResolvedValue({ prices: [], available: false })
    await renderHome()
    const pricing = document.getElementById('pricing') as HTMLElement
    expect(within(pricing).getAllByText('See pricing')).toHaveLength(2)
    expect(within(pricing).queryByText('₹100')).not.toBeInTheDocument()
  })

  it('renders the FAQ as an accessible accordion before the final call to action', async () => {
    const { container } = await renderHome()

    const faq = container.querySelector('section#faq') as HTMLElement
    expect(faq).not.toBeNull()
    const items = faq.querySelectorAll('details')
    expect(items.length).toBeGreaterThanOrEqual(8)
    expect(items.length).toBeLessThanOrEqual(10)
    for (const item of items) expect(item.querySelector('summary')).not.toBeNull()
    expect(within(faq).getByText('Is Sea N Shore free?')).toBeInTheDocument()
    expect(within(faq).getByRole('link', { name: 'See all questions' })).toHaveAttribute('href', '/help#faq')

    const sections = [...container.querySelectorAll('main > section')].map((section) => section.id || section.className)
    expect(sections.indexOf('faq')).toBe(sections.indexOf('join') - 1)
  })

  it('links every payment-gateway policy page and the FAQ from the footer', async () => {
    await renderHome()
    const footer = screen.getByRole('contentinfo')
    const hrefs = within(footer).getAllByRole('link').map((link) => link.getAttribute('href'))
    for (const href of ['/contact', '/terms', '/privacy', '/refunds', '/shipping', '/pricing', '/about', '/help', '/accessibility', '/newsletter', '#faq']) {
      expect(hrefs).toContain(href)
    }
    expect(within(footer).getByRole('link', { name: 'info@beaufortmarine.in' })).toHaveAttribute('href', 'mailto:info@beaufortmarine.in')
    expect(within(footer).getByRole('link', { name: /Instagram/ })).toHaveAttribute('href', 'https://www.instagram.com/seaandshore.in')
    expect(within(footer).getByRole('img', { name: 'Sea N Shore' })).toHaveAttribute('src', '/brand/sea-n-shore-lockup-white.webp')
  })

  it('uses the new ship logo in the header', async () => {
    await renderHome()
    const header = screen.getByRole('banner')
    expect(within(header).getByRole('img', { name: 'Sea N Shore' })).toHaveAttribute('src', '/brand/sea-n-shore-lockup.webp')
  })

  it('keeps content visible when IntersectionObserver is missing (tests, old browsers)', async () => {
    expect(typeof window.IntersectionObserver).toBe('undefined')
    const { container } = await renderHome()

    const root = container.querySelector('.lp') as HTMLElement
    expect(root.dataset.motion).toBe('off')
    const reveals = container.querySelectorAll('[data-reveal]')
    expect(reveals.length).toBeGreaterThan(20)
    for (const element of reveals) {
      expect(element.classList.contains('is-in') || element.classList.contains('is-seen')).toBe(false)
    }
    expect(screen.getByText('Know your fit before you apply.')).toBeVisible()
  })

  it('publishes Organization and FAQPage structured data', async () => {
    const { container } = await renderHome()
    const blocks = [...container.querySelectorAll('script[type="application/ld+json"]')].map((script) => JSON.parse(script.textContent ?? '{}'))
    expect(blocks.map((block) => block['@type'])).toEqual(['Organization', 'FAQPage'])
    expect(blocks[1].mainEntity.length).toBeGreaterThanOrEqual(8)
  })

  it('has page metadata for search and sharing', () => {
    expect(metadata.title).toEqual({ absolute: 'Sea N Shore — the maritime professional network' })
    expect(metadata.description).toContain('Maritime Passport')
  })
})

describe('landing page on phones (below 768px)', () => {
  it('shows the partners as one logo strip with "See all partners" opening the full grid in place', async () => {
    const { container } = await renderHome()
    const partners = container.querySelector('section#partners') as HTMLElement

    const strip = within(partners).getByRole('list', { name: 'Maritime companies on Sea N Shore' })
    expect(strip).toHaveClass('pstrip', 'swipe')
    expect(within(strip).getAllByRole('listitem').length).toBeGreaterThanOrEqual(6)
    expect(within(strip).getByRole('img', { name: 'Wallem' })).toBeInTheDocument()

    const seeAll = within(partners).getByRole('link', { name: /See all 40\+ partners/ })
    expect(seeAll).toHaveClass('pall-open')
    expect(seeAll).toHaveAttribute('href', '#partners-all')

    // The full grid is still rendered (desktop shows it; phones open it with the link above).
    const all = partners.querySelector('#partners-all') as HTMLElement
    expect(all).toHaveClass('pall')
    for (const title of ['Partners', 'Global partners', 'Companies hiring']) {
      expect(within(all).getByRole('heading', { level: 3, name: title })).toBeInTheDocument()
    }
    expect(within(all).getByRole('img', { name: 'Beaufort Marine Services LLP' })).toBeInTheDocument()
    expect(within(all).getByText('Nordships Maritime')).toBeInTheDocument()
    expect(within(all).getByRole('link', { name: 'Show fewer partners' })).toHaveAttribute('href', '#partners')
  })

  it('lays the feature cards, audiences and plans out as swipe rows', async () => {
    const { container } = await renderHome()

    const overview = container.querySelector('#features .ov-grid') as HTMLElement
    expect(overview).toHaveClass('swipe')
    expect([...overview.querySelectorAll('a.ov')].map((link) => link.getAttribute('href'))).toEqual(['#jobs', '#passport', '#learn', '#events', '#feed', '#organizations'])

    const audiences = container.querySelector('#who .aud-grid') as HTMLElement
    expect(audiences).toHaveClass('swipe')
    expect(audiences.querySelectorAll('article.who')).toHaveLength(4)

    const plans = container.querySelector('#pricing .prices') as HTMLElement
    expect(plans).toHaveClass('swipe')
    expect(plans.querySelectorAll('.price')).toHaveLength(3)
    expect(plans.querySelector('.price.pop')).toHaveTextContent('Creator Pro')
  })

  it('collapses the footer link groups into tap-to-open rows and keeps contact and social visible', async () => {
    await renderHome()
    const footer = screen.getByRole('contentinfo')
    const groups = within(footer).getByRole('navigation', { name: 'Footer links' })
    expect(groups).toHaveClass('fgroups')
    const details = groups.querySelectorAll('details')
    expect([...details].map((item) => item.querySelector('summary')?.textContent)).toEqual(['Platform', 'Company', 'Legal'])
    for (const item of details) expect(item).not.toHaveAttribute('open')
    const hrefs = within(groups).getAllByRole('link', { hidden: true }).map((link) => link.getAttribute('href'))
    for (const href of ['/pricing', '/about', '/help', '/contact', '/terms', '/privacy', '/refunds', '/shipping', '/copyright', '/accessibility', '#faq']) {
      expect(hrefs).toContain(href)
    }
    // Desktop columns are unchanged and marked so phones can hide them.
    for (const name of ['Platform', 'Company', 'Legal']) {
      expect(within(footer).getByRole('navigation', { name })).toHaveClass('fnav')
    }
    expect(within(footer).getByRole('link', { name: 'info@beaufortmarine.in' }).closest('.fnav')).toBeNull()
  })

  it('keeps the phone rules in one max-width 767.98px block with scroll-snap rows and :target partners', () => {
    const css = fs.readFileSync(path.join(process.cwd(), 'src/components/marketing/landing/landing.css'), 'utf8')
    const start = css.indexOf('@media (max-width:767.98px){')
    expect(start).toBeGreaterThan(0)
    const phone = css.slice(start)
    expect(phone).toMatch(/\.lp \.swipe\{display:flex;[^}]*overflow-x:auto;[^}]*scroll-snap-type:x mandatory/)
    expect(phone).toMatch(/\.lp \.swipe > \*\{[^}]*scroll-snap-align:start/)
    expect(phone).toContain('.lp .pall{display:none')
    expect(phone).toContain('.lp .pall:target{display:block}')
    expect(phone).toContain('.lp .sns.mpanel,.lp .sns.pdfchip,.lp .sns.certchip{display:none}')
    expect(phone).toContain('.lp .ticks li:nth-child(n+4){display:none}')
    expect(phone).toContain('.lp .sns .cmts{display:none}')
    expect(phone).toContain('.lp .aud .steps{display:none}')
    expect(phone).toContain('.lp .prices > .price.pop{order:-1}')
    expect(phone).toContain('.lp footer .fnav{display:none}')
    // Outside the phone block the phone-only pieces are hidden, so desktop is unchanged.
    expect(css.slice(0, start)).toContain('.lp .pstrip,.lp .pall-open,.lp .pall-close,.lp .fgroups{display:none}')
  })
})

describe('landing page source contract', () => {
  const read = (file: string) => fs.readFileSync(path.join(process.cwd(), file), 'utf8')

  it('keeps every landing animation inside the motion folder', () => {
    const dir = path.join(process.cwd(), 'src/components/marketing/landing')
    for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.tsx'))) {
      const source = read(`src/components/marketing/landing/${file}`)
      expect(source, file).not.toMatch(/IntersectionObserver|requestAnimationFrame|framer-motion/)
    }
  })

  it('scopes every landing style under .lp', () => {
    const css = read('src/components/marketing/landing/landing.css').replace(/\/\*[\s\S]*?\*\//g, '')
    const selectors = css
      .replace(/@keyframes[^{]+\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, '')
      .replace(/@media[^{]+\{/g, '')
      .split('}')
      .map((chunk) => chunk.split('{')[0]?.trim())
      .filter(Boolean)
    for (const selector of selectors) {
      for (const part of selector.split(',')) {
        expect(part.trim(), part).toMatch(/^(\.lp\b|html:has\(\.lp\))/)
      }
    }
  })
})

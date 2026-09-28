import Link from 'next/link'
import { OPERATOR_LINE } from '@/config/business'
import { configuredSocialLinks } from './social-links'

export type FooterLink = {
  href: string
  label: string
  /** Only meaningful for signed-in members (e.g. account settings). */
  signedInOnly?: boolean
}

export type FooterLinkGroup = { title: string; links: FooterLink[] }

/**
 * The one link set used by every footer (rail, compact and public). Every href
 * must resolve to a route in src/app — see footer-links.test.ts.
 */
export const FOOTER_LINK_GROUPS: FooterLinkGroup[] = [
  {
    title: 'Explore',
    links: [
      { href: '/jobs', label: 'Jobs' },
      { href: '/learn', label: 'Learn' },
      { href: '/events', label: 'Events' },
      { href: '/community', label: 'Community' },
    ],
  },
  {
    title: 'Sea N Shore',
    links: [
      { href: '/about', label: 'About' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/help', label: 'Help' },
      { href: '/contact', label: 'Contact us' },
      { href: '/newsletter', label: 'Newsletter' },
      { href: '/accessibility', label: 'Accessibility' },
    ],
  },
  {
    title: 'Legal & privacy',
    links: [
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/refunds', label: 'Refunds & cancellation' },
      { href: '/shipping', label: 'Shipping & delivery' },
      { href: '/copyright', label: 'Copyright & IP' },
      { href: '/settings#your-data', label: 'Your data & privacy', signedInOnly: true },
    ],
  },
]

export function footerLinks({ signedIn }: { signedIn: boolean }): FooterLink[] {
  return FOOTER_LINK_GROUPS.flatMap((group) => group.links).filter((link) => signedIn || !link.signedInOnly)
}

export function copyrightLine(year = new Date().getFullYear()) {
  return `© ${year} Sea N Shore · Global Shipping Community · All rights reserved.`
}

/** "Sea N Shore is operated by Beaufort Marine Services LLP · Navi Mumbai, India" — in every footer. */
export { OPERATOR_LINE }

export const CONTENT_OWNERSHIP_NOTE =
  'User-generated content remains owned by its respective creators or rights holders and is used on Sea N Shore under the permissions described in our Terms.'

export function FooterSocialLinks({ className = '' }: { className?: string }) {
  const social = configuredSocialLinks()
  if (!social.length) return null
  return (
    <ul aria-label="Sea N Shore on social media" className={`flex flex-wrap items-center gap-x-3 gap-y-1 ${className}`.trim()}>
      {social.map((link) => (
        <li key={link.key}>
          <a href={link.href} target="_blank" rel="noopener noreferrer" className="font-semibold hover:text-ocean-700 hover:underline">
            {link.label}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  )
}

/**
 * Compact footer shown at the end of the content on pages without a right rail
 * and at every phone width. When a page renders <RailFooter>, this footer hides
 * itself at the rail's breakpoint so the links are never shown twice.
 * Requires an ancestor with the `group/shell` class (the app layouts).
 */
export function AppFooter() {
  const links = footerLinks({ signedIn: true })
  return (
    <footer
      aria-label="Site footer"
      data-app-footer="compact"
      className="mx-auto w-full max-w-7xl px-4 pb-6 pt-2 sm:px-6 lg:group-has-data-[rail-footer=lg]/shell:hidden xl:group-has-data-[rail-footer=xl]/shell:hidden"
    >
      <div className="border-t border-mist-100 pt-4 text-xs text-muted">
        <nav aria-label="Footer">
          <ul className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {links.map((link) => (
              <li key={link.href}>
                <Link href={link.href} className="inline-flex min-h-8 items-center font-semibold transition hover:text-ocean-700 hover:underline">
                  {link.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <FooterSocialLinks className="mt-2" />
        <p className="mt-3">{copyrightLine()}</p>
        <p className="mt-1">{OPERATOR_LINE}</p>
        <p className="mt-1 max-w-3xl leading-5">{CONTENT_OWNERSHIP_NOTE}</p>
      </div>
    </footer>
  )
}

import Link from 'next/link'
import type { ReactElement, SVGProps } from 'react'
import { BUSINESS, OPERATOR_LINE, type BusinessDetails } from '@/config/business'
import { configuredSocialLinks, type SocialLink } from './social-links'

export type FooterLink = {
  href: string
  label: string
  /** Only meaningful for signed-in members (e.g. account settings). */
  signedInOnly?: boolean
}

export type FooterLinkGroup = { title: string; links: FooterLink[] }

/**
 * The one link set used by every footer (public, compact, rail, side drawer and
 * landing). Every href must resolve to a route in src/app — see footer-links.test.ts.
 */
export const FOOTER_LINK_GROUPS: FooterLinkGroup[] = [
  {
    title: 'Product',
    links: [
      { href: '/jobs', label: 'Jobs' },
      { href: '/learn', label: 'Learn' },
      { href: '/events', label: 'Events' },
      { href: '/community', label: 'Community' },
      { href: '/pricing', label: 'Pricing' },
    ],
  },
  {
    title: 'Company',
    links: [
      { href: '/about', label: 'About' },
      { href: '/contact', label: 'Contact us' },
      { href: '/newsletter', label: 'Newsletter' },
    ],
  },
  {
    title: 'Help & legal',
    links: [
      { href: '/help', label: 'Help' },
      { href: '/accessibility', label: 'Accessibility' },
      { href: '/terms', label: 'Terms' },
      { href: '/privacy', label: 'Privacy Policy' },
      { href: '/refunds', label: 'Refunds & cancellation' },
      { href: '/shipping', label: 'Shipping & delivery' },
      { href: '/copyright', label: 'Copyright & IP' },
      { href: '/settings#your-data', label: 'Your data & privacy', signedInOnly: true },
    ],
  },
]

/** The link groups with member-only links removed for signed-out visitors. */
export function footerLinkGroups({ signedIn }: { signedIn: boolean }): FooterLinkGroup[] {
  return FOOTER_LINK_GROUPS.map((group) => ({
    ...group,
    links: group.links.filter((link) => signedIn || !link.signedInOnly),
  }))
}

export function footerLinks({ signedIn }: { signedIn: boolean }): FooterLink[] {
  return footerLinkGroups({ signedIn }).flatMap((group) => group.links)
}

/** "© 2026 Sea N Shore · operated by Beaufort Marine Services LLP, Navi Mumbai, India" — the one line at the bottom of every footer. */
export function footerBottomLine(year = new Date().getFullYear(), business: BusinessDetails = BUSINESS) {
  return `© ${year} ${business.brandName} · operated by ${business.legalName}, ${business.city}, ${business.country}`
}

/** "Sea N Shore is operated by Beaufort Marine Services LLP · Navi Mumbai, India" — used by /help and /pricing. */
export { OPERATOR_LINE }

export const CONTENT_OWNERSHIP_NOTE =
  'User-generated content remains owned by its respective creators or rights holders and is used on Sea N Shore under the permissions described in our Terms.'

/* ---------- social icons (lucide has no brand marks, so these are tiny inline SVGs) ---------- */

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function svgProps({ size = 20, ...props }: IconProps) {
  return { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, focusable: false, ...props } as const
}

const strokeProps = { fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round', strokeLinejoin: 'round' } as const

function InstagramIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)} {...strokeProps}>
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
    </svg>
  )
}

function FacebookIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)} {...strokeProps}>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  )
}

/** The X (formerly Twitter) mark. */
function XIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)} fill="currentColor">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

function LinkedInIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)} {...strokeProps}>
      <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z" />
      <rect width="4" height="12" x="2" y="9" />
      <circle cx="4" cy="4" r="2" />
    </svg>
  )
}

function YouTubeIcon(props: IconProps) {
  return (
    <svg {...svgProps(props)} {...strokeProps}>
      <path d="M22.54 6.42a2.78 2.78 0 0 0-1.94-2C18.88 4 12 4 12 4s-6.88 0-8.6.46a2.78 2.78 0 0 0-1.94 2A29 29 0 0 0 1 11.75a29 29 0 0 0 .46 5.33A2.78 2.78 0 0 0 3.4 19c1.72.46 8.6.46 8.6.46s6.88 0 8.6-.46a2.78 2.78 0 0 0 1.94-2 29 29 0 0 0 .46-5.25 29 29 0 0 0-.46-5.33z" />
      <polygon points="9.75 15.02 15.5 11.75 9.75 8.48 9.75 15.02" />
    </svg>
  )
}

const SOCIAL_ICONS: Record<SocialLink['key'], (props: IconProps) => ReactElement> = {
  linkedin: LinkedInIcon,
  instagram: InstagramIcon,
  youtube: YouTubeIcon,
  facebook: FacebookIcon,
  x: XIcon,
}

const socialLinkClass =
  'inline-flex size-9 items-center justify-center rounded-full text-navy-900 transition hover:bg-mist-100 hover:text-ocean-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'

/**
 * The official social profiles as one row of icons. Each link is named for screen
 * readers ("Instagram (opens in a new tab)"); unconfigured profiles are never rendered.
 */
export function FooterSocialIcons({ className = '', linkClassName = socialLinkClass, size = 20 }: {
  className?: string
  /** Replaces the default light-theme link styling (the navy landing footer styles its own). */
  linkClassName?: string
  size?: number
}) {
  const social = configuredSocialLinks()
  if (!social.length) return null
  return (
    <ul aria-label="Sea N Shore on social media" className={`flex flex-wrap items-center gap-1 ${className}`.trim()}>
      {social.map((link) => {
        const Icon = SOCIAL_ICONS[link.key]
        return (
          <li key={link.key}>
            <a
              href={link.href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`${link.label} (opens in a new tab)`}
              title={link.label}
              className={linkClassName}
            >
              <Icon size={size} />
            </a>
          </li>
        )
      })}
    </ul>
  )
}

/* ---------- shared column layout ---------- */

const headingClass = 'text-xs font-bold uppercase tracking-[0.14em] text-muted'

/**
 * The three link groups as columns: two on phones, three from `sm` up. `compact`
 * is the small-text variant for the end-of-content footer.
 */
export function FooterLinkColumns({ signedIn, compact = false, className = '' }: {
  signedIn: boolean
  compact?: boolean
  className?: string
}) {
  const groups = footerLinkGroups({ signedIn })
  return (
    <nav aria-label="Footer" className={className}>
      <div className={`grid grid-cols-2 sm:grid-cols-3 ${compact ? 'gap-x-8 gap-y-4' : 'gap-8'}`}>
        {groups.map((group) => (
          <div key={group.title} className="min-w-0">
            <h2 className={compact ? 'text-[11px] font-bold uppercase tracking-[0.14em] text-muted' : headingClass}>{group.title}</h2>
            <ul className={`mt-2 grid ${compact ? 'gap-0' : 'gap-1'}`}>
              {group.links.map((link) => (
                <li key={link.href}>
                  <Link
                    href={link.href}
                    className={
                      compact
                        ? 'inline-flex min-h-7 items-center text-xs font-semibold text-navy-900 transition hover:text-ocean-700 hover:underline'
                        : 'inline-flex min-h-8 items-center text-sm font-semibold text-navy-900 transition hover:text-ocean-700 hover:underline'
                    }
                  >
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </nav>
  )
}

/**
 * Compact footer shown at the end of the content on pages without a right rail,
 * from the `md` breakpoint up. Phones do not show it: the same links are at the
 * bottom of the side drawer (side-drawer.tsx). When a page renders <RailFooter>,
 * this footer hides itself at the rail's breakpoint so the links are never shown twice.
 * Requires an ancestor with the `group/shell` class (the app layouts).
 */
export function AppFooter() {
  return (
    <footer
      aria-label="Site footer"
      data-app-footer="compact"
      className="mx-auto w-full max-w-7xl px-4 pb-6 pt-2 max-md:hidden sm:px-6 lg:group-has-data-[rail-footer=lg]/shell:hidden xl:group-has-data-[rail-footer=xl]/shell:hidden"
    >
      <div className="border-t border-mist-100 pt-5 text-xs text-muted">
        <div className="flex flex-wrap items-start justify-between gap-x-10 gap-y-5">
          <FooterLinkColumns signedIn compact className="max-w-2xl grow" />
          <FooterSocialIcons className="-ml-2 shrink-0" size={18} />
        </div>
        <p className="mt-5 border-t border-mist-100 pt-3">{footerBottomLine()}</p>
      </div>
    </footer>
  )
}

import Link from '@/components/navigation/intent-link'
import { FooterSocialIcons, footerBottomLine, footerLinkGroups, footerLinks } from './app-footer'
import { RailFooterMore } from './rail-footer-more'

type RailBreakpoint = 'lg' | 'xl'

const visibilityClass: Record<RailBreakpoint, string> = {
  lg: 'hidden lg:block',
  xl: 'hidden xl:block',
}

/** The few links shown before "More", in this order. */
const RAIL_KEY_HREFS = ['/help', '/terms', '/privacy', '/contact', '/pricing']

export function railKeyLinks() {
  const links = footerLinks({ signedIn: true })
  return RAIL_KEY_HREFS.flatMap((href) => links.filter((link) => link.href === href))
}

const linkClass = 'inline-flex min-h-6 items-center hover:text-ocean-700 hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'

/**
 * Compact footer for the bottom of a narrow right rail: a few key links, a
 * "More" disclosure with the full grouped list, the social icons and the bottom
 * line. Render it as the last child of the rail's container. It is part of the
 * rail's flow, never sticky (round F, F4): "More" opens downward and pushes the
 * page (or the rail's own scroller) instead of covering the cards above it. It
 * has the page background and leaves room at the bottom for the Messaging dock,
 * which is fixed over the right-rail column. `visibleFrom`
 * must match the breakpoint at which the rail itself is visible beside the content;
 * the full-width compact footer hides at that breakpoint so links never repeat.
 */
export function RailFooter({ visibleFrom = 'xl' }: { visibleFrom?: RailBreakpoint }) {
  return (
    <footer
      aria-label="Site footer"
      data-rail-footer={visibleFrom}
      className={`${visibilityClass[visibleFrom]} relative bg-mist-50 px-2 pb-16 pt-4 text-center text-[11px] leading-4 text-muted`}
    >
      <nav aria-label="Footer">
        <ul className="flex flex-wrap justify-center gap-x-3 gap-y-0.5">
          {railKeyLinks().map((link) => (
            <li key={link.href}>
              <Link href={link.href} className={linkClass}>
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
        <RailFooterMore className={linkClass}>
          {footerLinkGroups({ signedIn: true }).map((group) => (
            <div key={group.title}>
              <h2 className="text-[10px] font-bold uppercase tracking-[0.14em] text-muted">{group.title}</h2>
              <ul className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={linkClass}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </RailFooterMore>
      </nav>
      <FooterSocialIcons className="mt-1 justify-center" size={16} linkClassName="inline-flex size-8 items-center justify-center rounded-full text-navy-900 transition hover:bg-mist-100 hover:text-ocean-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500" />
      <p className="mt-2">{footerBottomLine()}</p>
    </footer>
  )
}

import Link from 'next/link'
import { FooterSocialLinks, footerLinks } from './app-footer'

type RailBreakpoint = 'lg' | 'xl'

const visibilityClass: Record<RailBreakpoint, string> = {
  lg: 'hidden lg:block',
  xl: 'hidden xl:block',
}

/**
 * LinkedIn-style compact footer for the bottom of a right rail. Render it as the
 * last child of the rail's sticky container. `visibleFrom` must match the
 * breakpoint at which the rail itself is visible beside the content; the
 * full-width compact footer hides at that breakpoint so links never repeat.
 */
export function RailFooter({ visibleFrom = 'xl' }: { visibleFrom?: RailBreakpoint }) {
  const links = footerLinks({ signedIn: true })
  return (
    <footer
      aria-label="Site footer"
      data-rail-footer={visibleFrom}
      className={`${visibilityClass[visibleFrom]} sticky bottom-0 z-[1] bg-mist-50 px-2 pb-3 pt-4 text-center text-[11px] leading-4 text-muted`}
    >
      <nav aria-label="Footer">
        <ul className="flex flex-wrap justify-center gap-x-3 gap-y-0.5">
          {links.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="inline-flex min-h-6 items-center hover:text-ocean-700 hover:underline">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <FooterSocialLinks className="mt-1 justify-center" />
      <p className="mt-2">
        <span className="font-bold text-navy-900">Sea N Shore</span> © {new Date().getFullYear()}
      </p>
    </footer>
  )
}

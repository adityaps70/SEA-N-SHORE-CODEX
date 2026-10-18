import { Wordmark } from '@/components/brand/wordmark'
import { NewsletterFooterSignup } from '@/features/newsletter/components/newsletter-footer-signup'
import { FooterLinkColumns, FooterSocialIcons, footerBottomLine } from './app-footer'

/**
 * Round H (H6): the one full footer, for signed-out visitors and members alike: brand, the
 * three link columns, social icons, the newsletter sign-up and one bottom line.
 *
 * - On pages with a right rail it hides at the rail's breakpoint, where the rail's own
 *   <RailFooter> shows the links, so a page never has two footers. Requires an ancestor with
 *   the `group/shell` class (every layout that renders it).
 * - Members do not see it on phones: the same links are at the bottom of the side drawer
 *   (side-drawer.tsx). Signed-out visitors have no drawer, so phones show it to them.
 */
export function SiteFooter({ signedIn }: { signedIn: boolean }) {
  return (
    <footer
      aria-label="Site footer"
      data-app-footer="site"
      className={`border-t border-mist-100 bg-white lg:group-has-data-[rail-footer=lg]/shell:hidden xl:group-has-data-[rail-footer=xl]/shell:hidden ${signedIn ? 'max-md:hidden' : ''}`.trim()}
    >
      <div className="mx-auto w-full max-w-page-wide px-4 py-10 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)_minmax(0,20rem)] lg:gap-12">
          <div className="min-w-0">
            <Wordmark compact />
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted">
              A professional maritime community connecting identity, people, knowledge and opportunity across sea and shore.
            </p>
            <FooterSocialIcons className="-ml-2 mt-4" />
          </div>

          <FooterLinkColumns signedIn={signedIn} className="min-w-0" />

          <NewsletterFooterSignup />
        </div>

        <p className="mt-10 border-t border-mist-100 pt-5 text-xs text-muted">{footerBottomLine()}</p>
      </div>
    </footer>
  )
}

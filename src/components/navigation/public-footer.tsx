import Link from 'next/link'
import { Wordmark } from '@/components/brand/wordmark'
import { getVerifiedUser } from '@/features/auth/queries'
import { NewsletterFooterSignup } from '@/features/newsletter/components/newsletter-footer-signup'
import { CONTENT_OWNERSHIP_NOTE, FOOTER_LINK_GROUPS, FooterSocialLinks, copyrightLine } from './app-footer'

/**
 * Footer for signed-out public and marketing pages. Same link set as the app
 * footers, grouped into columns, plus the newsletter sign-up.
 */
export async function PublicFooter() {
  let signedIn = false
  try {
    signedIn = Boolean(await getVerifiedUser())
  } catch {
    signedIn = false
  }

  return (
    <footer className="border-t border-mist-100 bg-white" aria-label="Site footer">
      <div className="mx-auto w-full max-w-7xl px-4 py-10 sm:px-6">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_minmax(0,22rem)]">
          <div>
            <Wordmark compact />
            <p className="mt-3 max-w-sm text-sm leading-6 text-muted">
              A professional maritime community connecting identity, people, knowledge and opportunity across sea and shore.
            </p>
            <FooterSocialLinks className="mt-4 text-sm text-navy-900" />
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-6 sm:grid-cols-3">
            {FOOTER_LINK_GROUPS.map((group) => (
              <div key={group.title}>
                <p className="text-xs font-bold uppercase tracking-[0.14em] text-muted">{group.title}</p>
                <ul className="mt-3 grid gap-1">
                  {group.links
                    .filter((link) => signedIn || !link.signedInOnly)
                    .map((link) => (
                      <li key={link.href}>
                        <Link href={link.href} className="inline-flex min-h-8 items-center text-sm font-semibold text-navy-900 hover:text-ocean-700">
                          {link.label}
                        </Link>
                      </li>
                    ))}
                </ul>
              </div>
            ))}
          </nav>

          <NewsletterFooterSignup />
        </div>

        <div className="mt-8 border-t border-mist-100 pt-5 text-xs text-muted">
          <p>{copyrightLine()}</p>
          <p className="mt-1 max-w-3xl leading-5">{CONTENT_OWNERSHIP_NOTE}</p>
        </div>
      </div>
    </footer>
  )
}

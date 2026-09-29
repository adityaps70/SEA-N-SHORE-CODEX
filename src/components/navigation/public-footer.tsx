import { Wordmark } from '@/components/brand/wordmark'
import { getVerifiedUser } from '@/features/auth/queries'
import { NewsletterFooterSignup } from '@/features/newsletter/components/newsletter-footer-signup'
import { FooterLinkColumns, FooterSocialIcons, footerBottomLine } from './app-footer'

/**
 * Footer for signed-out public and marketing pages: brand, the three link
 * columns shared with the app footers, the newsletter sign-up and one bottom line.
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

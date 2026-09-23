import Link from 'next/link'
import { Wordmark } from '@/components/brand/wordmark'
import { getPublicVisitorActions } from './public-visitor-actions'
import { getVerifiedUser } from '@/features/auth/queries'

const legalLinks = [
  { href: '/privacy', label: 'Privacy' },
  { href: '/terms', label: 'Terms' },
  { href: '/copyright', label: 'Copyright & IP' },
] as const

export async function PublicFooter() {
  const viewer = await getVerifiedUser()
  const actions = getPublicVisitorActions(Boolean(viewer))

  return (
    <footer className="border-t border-mist-100 bg-white" aria-label="Sea N Shore footer">
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div>
            <Wordmark compact />
            <p className="mt-3 max-w-md text-sm leading-6 text-muted">A professional maritime community connecting identity, people, knowledge and opportunity across sea and shore.</p>
          </div>
          <nav aria-label="Footer navigation" className="flex flex-wrap gap-2">
            <Link href={actions.secondary.href} className="rounded-lg px-3 py-2 text-sm font-semibold text-navy-900 hover:bg-mist-50">{actions.secondary.label}</Link>
            <Link href={actions.primary.href} className="rounded-lg bg-ocean-700 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-900">{actions.primary.label}</Link>
          </nav>
        </div>

        <div className="mt-7 flex flex-col gap-3 border-t border-mist-100 pt-5 text-xs text-muted md:flex-row md:items-center md:justify-between">
          <div>
            <p>© {new Date().getFullYear()} Sea N Shore · Global Shipping Community · All rights reserved.</p>
            <p className="mt-1 max-w-2xl leading-5">User-generated content remains owned by its respective creators or rights holders and is used under the permissions described in our Terms.</p>
          </div>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-2">
            {legalLinks.map((link) => (
              <Link key={link.href} href={link.href} className="font-semibold text-navy-900 hover:text-ocean-700">
                {link.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  )
}

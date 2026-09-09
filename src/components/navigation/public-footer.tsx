import Link from 'next/link'
import { Wordmark } from '@/components/brand/wordmark'
import { getPublicVisitorActions } from './public-visitor-actions'
import { getVerifiedUser } from '@/features/auth/queries'

export async function PublicFooter() {
  const viewer = await getVerifiedUser()
  const actions = getPublicVisitorActions(Boolean(viewer))

  return (
    <footer className="border-t border-mist-100 bg-white">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-8 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div>
          <Wordmark compact />
          <p className="mt-3 max-w-md text-sm leading-6 text-muted">A professional maritime community connecting identity, people, knowledge and opportunity across sea and shore.</p>
        </div>
        <nav aria-label="Footer navigation" className="flex flex-wrap gap-2">
          <Link href={actions.secondary.href} className="rounded-lg px-3 py-2 text-sm font-semibold text-navy-900 hover:bg-mist-50">{actions.secondary.label}</Link>
          <Link href={actions.primary.href} className="rounded-lg bg-ocean-700 px-4 py-2 text-sm font-semibold text-white hover:bg-navy-900">{actions.primary.label}</Link>
        </nav>
      </div>
    </footer>
  )
}

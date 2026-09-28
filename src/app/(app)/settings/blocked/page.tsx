import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { backLinkClass } from '@/components/ui/interactive-styles'
import { withAdminAvatarUrls } from '@/features/admin/avatars'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { blockedMembersRepository } from '@/features/network/blocked-members-repository'
import { BlockedMembersList } from './blocked-members-list'

export const metadata: Metadata = { title: 'Blocked members · Settings' }
export const dynamic = 'force-dynamic'

function blockedOn(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

/** Settings → Blocked members: the people the viewer blocked, each with Unblock. */
export default async function BlockedMembersPage() {
  const user = await requireAwsUser()
  const blocked = await withAdminAvatarUrls(await blockedMembersRepository.listBlockedByViewer(user.id))
  const members = blocked.map((member) => ({
    id: member.id,
    fullName: member.fullName,
    slug: member.slug,
    headline: member.headline,
    avatarUrl: member.avatarUrl,
    blockedOn: blockedOn(member.blockedAt),
  }))

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 py-2 max-md:space-y-3 max-md:py-0 sm:py-5">
      <MobilePageBar backHref="/settings" title="Blocked members" />
      <header className="max-md:hidden">
        <Link href="/settings" className={backLinkClass}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Settings
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">Blocked members</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Members you block can’t connect with or follow you, and their posts stay out of your feed. Blocking removed any connection or follow between you; unblocking doesn’t restore it.
        </p>
      </header>
      <p className="text-sm leading-6 text-muted md:hidden">
        Blocked members can’t connect with or follow you. Unblocking doesn’t reconnect you.
      </p>
      <section className="overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:shadow-none">
        <BlockedMembersList members={members} />
      </section>
    </main>
  )
}

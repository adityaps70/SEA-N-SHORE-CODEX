import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { backLinkClass } from '@/components/ui/interactive-styles'
import { withAdminAvatarUrls } from '@/features/admin/avatars'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { blockedMembersRepository } from '@/features/network/blocked-members-repository'
import { signalsRepository } from '@/features/signals/repository'
import { BlockedMembersList } from './blocked-members-list'
import { MutedList } from './muted-list'

export const metadata: Metadata = { title: 'Blocked & muted · Settings' }
export const dynamic = 'force-dynamic'

function blockedOn(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(date)
}

/** Settings → Blocked & muted: the people the viewer blocked (Unblock), and those muted in the feed (Unmute). */
export default async function BlockedMembersPage() {
  const user = await requireAwsUser()
  const [blockedRows, mutedRows] = await Promise.all([
    blockedMembersRepository.listBlockedByViewer(user.id),
    // Before migration 0083 the mutes table does not exist; the section is then empty.
    signalsRepository.listMutes(user.id).catch(() => []),
  ])
  const blocked = await withAdminAvatarUrls(blockedRows)
  const muted = mutedRows.map((item) => ({ ...item, mutedOn: blockedOn(item.mutedAt) }))
  const members = blocked.map((member) => ({
    id: member.id,
    fullName: member.fullName,
    slug: member.slug,
    headline: member.headline,
    avatarUrl: member.avatarUrl,
    blockedOn: blockedOn(member.blockedAt),
  }))

  return (
    <main className="mx-auto w-full max-w-page-narrow space-y-6 py-2 max-md:space-y-3 max-md:py-0 sm:py-5">
      <MobilePageBar backHref="/settings" title="Blocked & muted" />
      <header className="max-md:hidden">
        <Link href="/settings" className={backLinkClass}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Settings
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">Blocked &amp; muted</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Members you block can’t connect with or follow you, and their posts stay out of your feed. Blocking removed any connection or follow between you; unblocking doesn’t restore it.
        </p>
      </header>
      <p className="text-sm leading-6 text-muted md:hidden">
        Blocked members can’t connect with or follow you. Unblocking doesn’t reconnect you.
      </p>
      <section aria-labelledby="blocked-heading" className="overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:shadow-none">
        <h2 id="blocked-heading" className="border-b border-mist-100 px-5 py-3 text-base font-semibold text-navy-950">Blocked members</h2>
        <BlockedMembersList members={members} />
      </section>
      <section aria-labelledby="muted-heading" className="overflow-hidden rounded-2xl border border-mist-100 bg-white shadow-[var(--shadow-card)] max-md:-mx-4 max-md:rounded-none max-md:border-x-0 max-md:shadow-none">
        <h2 id="muted-heading" className="border-b border-mist-100 px-5 py-3 text-base font-semibold text-navy-950">Muted</h2>
        <p className="px-5 pt-3 text-sm leading-6 text-muted">Muted members and organizations aren’t told. Their posts stay out of your feed; everything else is unchanged.</p>
        <MutedList items={muted} />
      </section>
    </main>
  )
}

import type { Metadata } from 'next'
import Link from '@/components/navigation/intent-link'
import { buttonClass } from '@/components/ui/interactive-styles'
import { cn } from '@/lib/cn'
import { requireUser } from '@/features/auth/queries'
import { TicketStatusBadge } from '@/features/support/components/ticket-status-badge'
import { formatSupportDate } from '@/features/support/components/ticket-thread'
import { supportRepository, type SupportTicketSummary } from '@/features/support/repository'
import { supportTicketReference, supportTopicShortLabel } from '@/features/support/topics'

export const metadata: Metadata = { title: 'My requests · Help', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

const PAGE_WIDTH = 'max-w-4xl' // Round H (H6) width token: switch to max-w-page-narrow when the tokens land.

/**
 * Round H (H7): Help › My requests. The messages a signed-in member sent from the Contact page, with
 * their status (open, answered, closed). Visitors who were not signed in get answers by email only.
 */
export default async function MyRequestsPage() {
  const user = await requireUser()
  const tickets: SupportTicketSummary[] | null = await supportRepository.listTicketsForMember(user.id).catch(() => null)

  return (
    <div className={`mx-auto w-full ${PAGE_WIDTH} space-y-5 py-2 max-md:space-y-3 max-md:py-0 sm:py-5`}>
      <div>
        <Link href="/help" className="inline-flex min-h-11 items-center text-sm font-semibold text-ocean-700 hover:text-navy-950 hover:underline">← Help</Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950 max-md:text-2xl">My requests</h1>
        <p className="mt-2 text-sm leading-6 text-muted max-md:text-base">
          Messages you sent from the Contact page while signed in, and our answers. We also reply by email.
        </p>
      </div>

      {tickets === null ? (
        <p role="alert" className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">Your requests could not be loaded just now. Please refresh the page in a minute.</p>
      ) : tickets.length ? (
        <ul className="grid gap-3">
          {tickets.map((ticket) => (
            <li key={ticket.id}>
              <Link href={`/help/requests/${ticket.id}`} className="block rounded-2xl border border-mist-200 bg-white p-4 transition hover:border-ocean-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500">
                <span className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-navy-950">{supportTopicShortLabel(ticket.topic)} · {supportTicketReference(ticket.id)}</span>
                  <TicketStatusBadge status={ticket.status} />
                </span>
                <span className="mt-1 block break-words text-sm leading-6 text-muted max-md:text-base">{ticket.preview}</span>
                <span className="mt-1 block text-xs text-muted">Last update {formatSupportDate(ticket.lastMessageAt)}</span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-2xl border border-mist-100 bg-white p-5">
          <p className="font-semibold text-navy-950">You have not sent us a message yet.</p>
          <p className="mt-1 text-sm leading-6 text-muted max-md:text-base">Messages you send from the Contact page while signed in appear here.</p>
        </div>
      )}

      <Link href="/contact#contact-form" className={cn(buttonClass({ variant: 'primary', size: 'sm' }), 'min-h-11')}>
        Send a new message
      </Link>
    </div>
  )
}

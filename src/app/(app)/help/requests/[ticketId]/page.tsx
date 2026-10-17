import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import Link from '@/components/navigation/intent-link'
import { requireUser } from '@/features/auth/queries'
import { replyToMyTicket } from '@/features/support/actions'
import { TicketReplyForm } from '@/features/support/components/ticket-reply-form'
import { TicketStatusBadge } from '@/features/support/components/ticket-status-badge'
import { TicketThread, formatSupportDate } from '@/features/support/components/ticket-thread'
import { supportRepository } from '@/features/support/repository'
import { supportTicketReference, supportTopicLabel } from '@/features/support/topics'

export const metadata: Metadata = { title: 'Request · My requests', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

const PAGE_WIDTH = 'max-w-4xl' // Round H (H6) width token: switch to max-w-page-narrow when the tokens land.

/** Round H (H7): one of the member's own requests, its messages, and a reply box while it is open or answered. */
export default async function MyRequestPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const [{ ticketId }, user] = await Promise.all([params, requireUser()])
  const ticket = await supportRepository.getTicketForMember(user.id, ticketId)
  if (!ticket) notFound()
  const reference = supportTicketReference(ticket.id)

  return (
    <div className={`mx-auto w-full ${PAGE_WIDTH} space-y-5 py-2 max-md:space-y-3 max-md:py-0 sm:py-5`}>
      <div>
        <Link href="/help/requests" className="inline-flex min-h-11 items-center text-sm font-semibold text-ocean-700 hover:text-navy-950 hover:underline">← My requests</Link>
        <div className="mt-1 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-navy-950">Request {reference}</h1>
          <TicketStatusBadge status={ticket.status} />
        </div>
        <p className="mt-1 text-sm text-muted">{supportTopicLabel(ticket.topic)} · Sent {formatSupportDate(ticket.createdAt)}</p>
      </div>

      <TicketThread messages={ticket.messages} viewer="member" />

      {ticket.status === 'closed' ? (
        <p className="rounded-2xl border border-mist-100 bg-white p-4 text-sm leading-6 text-muted max-md:text-base">
          This request is closed. If you still need help, <Link href="/contact#contact-form" className="font-semibold text-ocean-700 hover:underline">send a new message</Link>.
        </p>
      ) : (
        <section aria-labelledby="reply-heading" className="rounded-2xl border border-mist-100 bg-white p-4">
          <h2 id="reply-heading" className="sr-only">Reply</h2>
          <TicketReplyForm action={replyToMyTicket.bind(null, ticket.id)} label="Your reply" hint="We answer by email and here." submitLabel="Send reply" />
        </section>
      )}
    </div>
  )
}

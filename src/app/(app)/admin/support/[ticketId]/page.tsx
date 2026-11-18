import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { replyToTicketAsAdmin } from '@/features/support/admin-actions'
import { AdminTicketStatusActions } from '@/features/support/components/admin-ticket-status-actions'
import { TicketReplyForm } from '@/features/support/components/ticket-reply-form'
import { TicketStatusBadge } from '@/features/support/components/ticket-status-badge'
import { TicketThread } from '@/features/support/components/ticket-thread'
import { supportRepository } from '@/features/support/repository'
import { supportTicketReference, supportTopicLabel } from '@/features/support/topics'
import { requireAdminAccess } from '@/features/admin/admin-access'

export const metadata: Metadata = { title: 'Support request · Admin' }
export const dynamic = 'force-dynamic'

const PAGE_WIDTH = 'max-w-4xl' // Round H (H6) width token: switch to max-w-page-narrow when the tokens land.

/** Round H (H7): one Contact page request: the thread, a reply box, and close / reopen. */
export default async function AdminSupportTicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  // Round GP (Part C): platform administrators only (default deny for country admins).
  await requireAdminAccess('platform')
  const { ticketId } = await params
  const ticket = await supportRepository.getTicketForAdmin(ticketId)
  if (!ticket) notFound()

  return (
    <div className={`w-full ${PAGE_WIDTH} space-y-5`}>
      <Link href="/admin/support" className="inline-flex min-h-9 items-center text-sm font-semibold text-ocean-700 hover:underline">← Support</Link>
      <AdminPageHeader
        title={`Request ${supportTicketReference(ticket.id)}`}
        meta={<TicketStatusBadge status={ticket.status} />}
        description={`${supportTopicLabel(ticket.topic)} · sent ${formatAdminDate(ticket.createdAt, true)}${ticket.closedAt ? ` · closed ${formatAdminDate(ticket.closedAt, true)}` : ''}`}
      />
      <AdminPanel className="p-4 sm:p-5">
        <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
          <dt className="font-semibold text-navy-950">From</dt>
          <dd className="min-w-0 break-words text-navy-900">
            {ticket.senderName}{' · '}<a href={`mailto:${ticket.senderEmail}`} className="font-semibold text-ocean-700 hover:underline">{ticket.senderEmail}</a>
          </dd>
          <dt className="font-semibold text-navy-950">Account</dt>
          <dd className="min-w-0 text-navy-900">
            {ticket.senderProfileId
              ? <Link href={`/admin/users/${ticket.senderProfileId}`} className="font-semibold text-ocean-700 hover:underline">Signed-in member (sees replies under Help › My requests)</Link>
              : 'Visitor, not signed in (gets replies by email only)'}
          </dd>
        </dl>
      </AdminPanel>

      <TicketThread messages={ticket.messages} viewer="admin" senderName={ticket.senderName} />

      {ticket.status === 'closed' ? (
        <p className="text-sm text-muted">This request is closed. Reopen it to reply.</p>
      ) : (
        <AdminPanel className="p-4 sm:p-5">
          <TicketReplyForm
            action={replyToTicketAsAdmin.bind(null, ticket.id)}
            label="Reply to the sender"
            hint="Sent by email to the sender and marked answered. Members also see it under Help › My requests."
            submitLabel="Send reply"
          />
        </AdminPanel>
      )}
      <AdminTicketStatusActions ticketId={ticket.id} status={ticket.status} />
    </div>
  )
}

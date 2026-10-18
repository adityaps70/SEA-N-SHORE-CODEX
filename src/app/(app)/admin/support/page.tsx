import type { Metadata } from 'next'
import Link from 'next/link'
import {
  AdminEmptyState,
  AdminFilterBar,
  AdminPageHeader,
  AdminPagination,
  AdminPanel,
  formatAdminDate,
  readAdminPage,
} from '@/features/admin/components/admin-ui'
import { TicketStatusBadge } from '@/features/support/components/ticket-status-badge'
import { supportRepository } from '@/features/support/repository'
import { isSupportTicketStatus, supportTicketReference, supportTopicShortLabel, type SupportTicketStatus } from '@/features/support/topics'

export const metadata: Metadata = { title: 'Support · Admin' }
export const dynamic = 'force-dynamic'

type SearchParams = Promise<Record<string, string | string[] | undefined>>

const PAGE_SIZE = 50
const PAGE_WIDTH = 'max-w-7xl' // Round H (H6) width token: switch to max-w-page-wide when the tokens land.

const FILTERS: Array<{ value: SupportTicketStatus | 'all'; label: string }> = [
  { value: 'open', label: 'Open' },
  { value: 'answered', label: 'Answered' },
  { value: 'closed', label: 'Closed' },
  { value: 'all', label: 'All' },
]

function readStatus(value: string | string[] | undefined): SupportTicketStatus | 'all' {
  const candidate = Array.isArray(value) ? value[0] : value
  return candidate === 'all' || isSupportTicketStatus(candidate) ? candidate : 'open'
}

/** Round H (H7): Admin › Support. Contact page requests by status, open ones first. */
export default async function AdminSupportPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams
  const status = readStatus(params.status)
  const page = readAdminPage(params.page)
  const result = await supportRepository.listTicketsForAdmin({ status, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE }).catch(() => null)
  const tickets = result?.tickets.slice(0, PAGE_SIZE) ?? []
  const counts = result?.counts
  const total = counts ? counts.open + counts.answered + counts.closed : null

  return (
    <div className={`w-full ${PAGE_WIDTH} space-y-5`}>
      <AdminPageHeader
        title="Support"
        meta={counts ? `${counts.open} open` : undefined}
        description="Messages from the Contact page. Answer here: the sender gets your reply by email, and signed-in members also see it under Help › My requests."
      />
      <AdminFilterBar
        label="Filter requests by status"
        options={FILTERS.map((filter) => ({
          href: `/admin/support?status=${filter.value}`,
          label: filter.label,
          active: filter.value === status,
          count: counts ? (filter.value === 'all' ? total : counts[filter.value]) : null,
        }))}
      />
      <AdminPanel>
        {result === null ? (
          <AdminEmptyState title="Requests could not be loaded." description="Is migration 0089 applied? Refresh the page in a minute." />
        ) : tickets.length ? (
          <ul className="divide-y divide-mist-100">
            {tickets.map((ticket) => (
              <li key={ticket.id}>
                <Link href={`/admin/support/${ticket.id}`} className="block px-4 py-3 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500 sm:px-5">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold text-navy-950">{supportTicketReference(ticket.id)} · {supportTopicShortLabel(ticket.topic)}</span>
                    <TicketStatusBadge status={ticket.status} />
                    {!ticket.signedIn ? <span className="text-xs font-semibold text-muted">Visitor (email only)</span> : null}
                    <span className="ml-auto text-xs text-muted">{formatAdminDate(ticket.lastMessageAt, true)}</span>
                  </span>
                  <span className="mt-1 block break-words text-sm text-navy-900">{ticket.senderName} · {ticket.senderEmail}</span>
                  <span className="mt-0.5 block break-words text-sm text-muted">{ticket.preview}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <AdminEmptyState title={status === 'open' ? 'No open requests.' : 'No requests here.'} description="New Contact page messages appear under Open." />
        )}
      </AdminPanel>
      <AdminPagination
        label="Support request pages"
        page={page}
        hasNext={(result?.tickets.length ?? 0) > PAGE_SIZE}
        hrefFor={(next) => `/admin/support?status=${status}&page=${next}`}
      />
    </div>
  )
}

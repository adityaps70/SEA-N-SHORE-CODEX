import { SUPPORT_STATUS_LABELS, type SupportTicketStatus } from '../topics'

const STATUS_CLASS: Record<SupportTicketStatus, string> = {
  open: 'bg-amber-50 text-amber-900 ring-amber-200',
  answered: 'bg-emerald-50 text-emerald-800 ring-emerald-200',
  closed: 'bg-mist-100 text-navy-900 ring-mist-200',
}

/** Round H (H7): a ticket's status as text in a pill (the colour is never the only signal). */
export function TicketStatusBadge({ status }: { status: SupportTicketStatus }) {
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-bold ring-1 ring-inset ${STATUS_CLASS[status]}`}>
      {SUPPORT_STATUS_LABELS[status]}
    </span>
  )
}

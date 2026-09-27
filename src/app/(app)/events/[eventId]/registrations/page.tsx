import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Info } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { calendarEventRepository } from '@/features/events/calendar-repository'
import { EventNav } from '@/features/events/components/event-nav'
import { eventPriceLabel } from '@/features/events/event-labels'
import { formatMoney } from '@/features/payments/currency'
import { eventPaymentRepository, type OrganizerPaymentRow } from '@/features/payments/event-payment-repository'
import { paymentStatusLabel, refundReasonLabel } from '@/features/payments/event-payment-rules'
import { arePaymentsConfigured } from '@/features/payments/provider'

export const metadata: Metadata = { title: 'Paid registrations' }

function dateLabel(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

function totalsByCurrency(rows: OrganizerPaymentRow[]) {
  const totals = new Map<string, number>()
  for (const row of rows) {
    if (row.status !== 'paid' || !row.registrationConfirmedAt) continue
    totals.set(row.currency, (totals.get(row.currency) ?? 0) + row.amountMinor)
  }
  return [...totals.entries()].map(([currency, amount]) => formatMoney(amount, currency))
}

export default async function EventRegistrationsPage({ params }: { params: Promise<{ eventId: string }> }) {
  const user = await requireAwsUser()
  const { eventId } = await params
  const event = await calendarEventRepository.getEvent(eventId, user.id)
  if (!event) notFound()
  if (!event.viewerIsHost) redirect(`/events/${event.id}`)

  const [rows, paymentsConfigured] = await Promise.all([
    eventPaymentRepository.listEventPaymentsForManager(user.id, event.id),
    arePaymentsConfigured(),
  ])
  const confirmed = rows.filter((row) => row.status === 'paid' && row.registrationConfirmedAt)
  const refundDue = rows.filter((row) => row.status === 'paid' && !row.registrationConfirmedAt)
  const totals = totalsByCurrency(rows)

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6 py-2 sm:px-6 sm:py-6">
      <EventNav active="hosting" />
      <div>
        <Link href={`/events/${event.id}`} className="inline-flex items-center gap-1.5 text-sm font-bold text-teal-700 hover:text-teal-800">
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to event
        </Link>
        <p className="mt-3 text-xs font-bold uppercase tracking-[0.18em] text-teal-700">Organizer workspace</p>
        <h1 className="text-3xl font-bold text-navy-950">Paid registrations</h1>
        <p className="mt-2 break-words text-sm text-muted">{event.title} · {event.pricing === 'paid' ? `Ticket price ${eventPriceLabel(event)}` : 'This event is currently free'}</p>
      </div>

      <section className="flex gap-3 rounded-2xl border border-teal-100 bg-teal-50/60 p-4 text-sm leading-6 text-navy-800">
        <Info className="mt-1 h-4 w-4 shrink-0 text-teal-700" aria-hidden="true" />
        <div>
          <p className="font-bold text-navy-950">How payouts and refunds work</p>
          <p>Attendees pay Sea N Shore when they register. Payouts to you and any refunds are handled by the Sea N Shore team outside the site for now — this page does not send money. <Link href="/help" className="font-bold text-teal-700 hover:underline">Contact the Sea N Shore team</Link> about a payout or a refund.</p>
        </div>
      </section>

      {!paymentsConfigured ? (
        <p role="status" className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm font-semibold leading-6 text-amber-900">
          Payments aren&apos;t switched on for Sea N Shore yet. Attendees see &ldquo;Registration opens soon&rdquo; on paid events until they are.
        </p>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-mist-100 bg-white p-4 shadow-sm">
          <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Confirmed paid seats</dt>
          <dd className="mt-1 text-2xl font-bold text-navy-950">{confirmed.length}{event.capacity ? <span className="text-base font-semibold text-muted"> / {event.capacity}</span> : null}</dd>
        </div>
        <div className="rounded-2xl border border-mist-100 bg-white p-4 shadow-sm">
          <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Collected</dt>
          <dd className="mt-1 text-2xl font-bold text-navy-950">{totals.length ? totals.join(' + ') : formatMoney(0, event.currency ?? 'INR')}</dd>
        </div>
        <div className="rounded-2xl border border-mist-100 bg-white p-4 shadow-sm">
          <dt className="text-xs font-bold uppercase tracking-[0.12em] text-muted">Refunds due</dt>
          <dd className="mt-1 text-2xl font-bold text-navy-950">{refundDue.length}</dd>
        </div>
      </dl>

      <section className="rounded-[1.5rem] border border-mist-100 bg-white shadow-[var(--shadow-card)]">
        <h2 className="border-b border-mist-100 px-5 py-4 text-lg font-bold text-navy-950">Payments</h2>
        {rows.length ? (
          <ul className="divide-y divide-mist-100">
            {rows.map((row) => {
              const status = paymentStatusLabel(row)
              return (
                <li key={row.id} className="grid gap-2 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <p className="truncate font-bold text-navy-950">
                      {row.attendeeSlug ? <Link href={`/profile/${row.attendeeSlug}`} className="hover:text-teal-700">{row.attendeeName ?? 'Sea N Shore member'}</Link> : row.attendeeName ?? 'Former member'}
                    </p>
                    <p className="text-xs text-muted">
                      {row.status === 'refunded' ? `Refunded ${dateLabel(row.refundedAt)}` : row.paidAt ? `Paid ${dateLabel(row.paidAt)}` : `Started ${dateLabel(row.createdAt)}`}
                    </p>
                    {row.status === 'paid' && !row.registrationConfirmedAt ? (
                      <p className="mt-1 text-xs leading-5 text-amber-900">{refundReasonLabel(row.refundDueReason)} The Sea N Shore team will refund this payment.</p>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                    <span className="text-sm font-bold text-navy-950">{formatMoney(row.amountMinor, row.currency)}</span>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${status.tone}`}>{status.label}</span>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="px-5 py-8 text-center text-sm text-muted">No one has paid for this event yet. Paid registrations will appear here as soon as attendees buy a ticket.</p>
        )}
      </section>
    </div>
  )
}

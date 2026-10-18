import type { Metadata } from 'next'
import Link from 'next/link'
import { textLinkClass } from '@/components/ui/interactive-styles'
import { AdminChip, AdminEmptyState, AdminPageHeader, AdminPanel, formatAdminDate } from '@/features/admin/components/admin-ui'
import { requirePaymentsAdmin } from '@/features/payouts/admin-guard'
import { PaymentsAdminTabs } from '@/features/payouts/components/admin/payments-admin-tabs'
import { SellerInvoiceReviewActions } from '@/features/payouts/components/admin/seller-invoice-review-actions'
import { formatExactMoney } from '@/features/payouts/payout-rules'
import { readClient } from '@/features/payouts/payout-runtime'
import { periodLabel, SELLER_INVOICE_KIND_LABELS, sellerInvoiceFileRoute } from '@/features/payouts/seller-invoice-rules'
import { listSellerInvoicesForReview, type SellerInvoiceReviewLine } from '@/features/payouts/seller-invoices'

export const metadata: Metadata = { title: 'Seller invoices · Payments · Admin' }
export const dynamic = 'force-dynamic'

function sellerHref(line: SellerInvoiceReviewLine) {
  if (!line.sellerSlug) return null
  return line.sellerKind === 'organization' ? `/organizations/${line.sellerSlug}` : `/people/${line.sellerSlug}`
}

function SellerName({ line }: { line: SellerInvoiceReviewLine }) {
  const href = sellerHref(line)
  return (
    <span className="min-w-0">
      {href ? <Link href={href} className={`${textLinkClass} break-words`}>{line.sellerName}</Link> : <span className="break-words font-semibold text-navy-950">{line.sellerName}</span>}
      <span className="ml-1.5 text-xs text-muted">{line.sellerKind === 'organization' ? 'Organization' : 'Member'}</span>
    </span>
  )
}

function InvoiceFacts({ line }: { line: SellerInvoiceReviewLine }) {
  const kindMismatch = line.gstRegistered !== null && (line.kind === 'tax_invoice') !== line.gstRegistered
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="flex flex-wrap items-baseline gap-x-2"><SellerName line={line} /></p>
      <p className="break-words text-xs text-muted">
        {periodLabel(line.period)} · {SELLER_INVOICE_KIND_LABELS[line.kind]} <span className="font-semibold text-navy-900">{line.documentNumber}</span> · sent {formatAdminDate(line.createdAt, true)}
      </p>
      <p className="break-words text-xs">
        <a href={sellerInvoiceFileRoute(line.id)} className={textLinkClass}>Open {line.fileName}</a>
        <span className="text-muted"> · {Math.max(1, Math.round(line.sizeBytes / 1024))} KB</span>
      </p>
      {kindMismatch ? (
        <p className="text-xs leading-5 text-amber-900">The seller&apos;s tax details changed since: they are now {line.gstRegistered ? 'GST registered' : 'not GST registered'}.</p>
      ) : null}
    </div>
  )
}

export default async function AdminSellerInvoicesPage() {
  await requirePaymentsAdmin()
  const [submitted, reviewed] = await Promise.all([
    listSellerInvoicesForReview(readClient, { status: 'submitted' }),
    listSellerInvoicesForReview(readClient, { status: 'reviewed', limit: 30 }),
  ])

  return (
    <div className="space-y-6">
      <AdminPageHeader
        title="Payments"
        meta={submitted.length ? `${submitted.length} invoice${submitted.length === 1 ? '' : 's'} to review` : 'No invoices to review'}
        description="Course sellers invoice Sea N Shore every month for their course earnings. A month's course earnings can be paid once its invoice is approved."
      />
      <PaymentsAdminTabs />

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Waiting for review</h3>
          <p className="text-xs text-muted">Check the file: addressed to Sea N Shore, the seller&apos;s number and date, and the total. GST-registered sellers send a tax invoice; others a bill of supply with no GST.</p>
        </div>
        {submitted.length ? (
          <ul className="divide-y divide-mist-100">
            {submitted.map((line) => {
              const matches = line.amountMinor === line.currentExpectedMinor
              return (
                <li key={line.id} className="grid gap-3 px-5 py-3 text-sm md:grid-cols-[minmax(0,1fr)_12rem_15rem] md:items-start md:gap-4">
                  <InvoiceFacts line={line} />
                  <dl className="space-y-0.5 md:text-right">
                    <div>
                      <dt className="sr-only">Invoice amount</dt>
                      <dd className="font-bold tabular-nums text-navy-950">{formatExactMoney(line.amountMinor)}</dd>
                    </div>
                    <div>
                      <dt className="inline text-xs text-muted">Course earnings for the month: </dt>
                      <dd className={`inline text-xs font-semibold tabular-nums ${matches ? 'text-emerald-800' : 'text-red-700'}`}>{formatExactMoney(line.currentExpectedMinor)}</dd>
                    </div>
                    {!matches ? <dd className="text-xs leading-5 text-red-700">Changed since it was sent (a refund). Reject it so the seller invoices the new amount.</dd> : null}
                  </dl>
                  <SellerInvoiceReviewActions invoiceId={line.id} summary={`${line.sellerName}, ${periodLabel(line.period)}`} canApprove={matches} />
                </li>
              )
            })}
          </ul>
        ) : (
          <AdminEmptyState title="Nothing to review" description="New seller invoices appear here as soon as they are uploaded." />
        )}
      </AdminPanel>

      <AdminPanel>
        <div className="border-b border-mist-100 px-5 py-3">
          <h3 className="text-sm font-bold text-navy-950">Recently reviewed</h3>
        </div>
        {reviewed.length ? (
          <ul className="divide-y divide-mist-100">
            {reviewed.map((line) => (
              <li key={line.id} className="grid gap-2 px-5 py-3 text-sm md:grid-cols-[minmax(0,1fr)_auto] md:items-start md:gap-4">
                <InvoiceFacts line={line} />
                <div className="space-y-1 md:text-right">
                  <p className="flex items-center gap-2 md:justify-end">
                    <span className="font-bold tabular-nums text-navy-950">{formatExactMoney(line.amountMinor)}</span>
                    <AdminChip tone={line.status === 'approved' ? 'success' : 'danger'}>{line.status === 'approved' ? 'Approved' : 'Rejected'}</AdminChip>
                  </p>
                  <p className="text-xs text-muted">{formatAdminDate(line.reviewedAt, true)}</p>
                  {line.reviewNote ? <p className="max-w-xs break-words text-xs leading-5 text-navy-800 md:ml-auto">{line.reviewNote}</p> : null}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <AdminEmptyState title="No invoices reviewed yet" />
        )}
      </AdminPanel>
    </div>
  )
}

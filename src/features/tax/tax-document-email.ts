import type { QueryResultRow } from 'pg'
import { withTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { createResendEmailClient, loadResendApiKey, ResendApiError, type ResendEmailClient } from '@/lib/email/resend'
import { withEmailSuppression } from '@/lib/email/suppression'
import { learningEmailSiteUrl } from '@/features/learning/learning-email'
import { taxMoney } from './gst'
import { buildCreditNotePdf, buildTaxInvoicePdf, taxDocumentDate, taxDocumentFileName } from './tax-document-pdf'
import { CREDIT_NOTE_COLUMNS, INVOICE_COLUMNS, mapCreditNote, mapInvoice, type TaxCreditNote, type TaxInvoice } from './tax-document-repository'

/**
 * Emails each issued GST document to its buyer (C4), from the outbox worker: public.tax_document_emails is the queue,
 * one row per invoice or credit note. A row is claimed with a 15-minute lease, so a crashed send is retried and never
 * doubled (the Resend idempotency key is the document). A tax document is transactional: it is sent even when the
 * learner turned learning emails off. A buyer with no verified email address is skipped.
 */

type Client = Pick<DatabaseQueryClient, 'query'>
type Transaction = <T>(work: (client: Client) => Promise<T>) => Promise<T>
type Sender = Pick<ResendEmailClient, 'sendEmail'>

export const TAX_DOCUMENT_EMAIL_FROM = 'Sea N Shore <billing@mail.seanshore.in>'
const MAX_ATTEMPTS = 5

export type TaxDocumentType = 'invoice' | 'credit_note'
export type TaxDocumentDelivery = { id: string; documentType: TaxDocumentType; documentId: string }

type LoadedDocument = {
  invoice: TaxInvoice
  note: TaxCreditNote | null
  courseTitle: string
  email: string | null
}

function escapeHtml(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** The email that carries a tax invoice or credit note. Names no one: the buyer's name is on the PDF only. */
export function taxDocumentEmail(input: { invoice: TaxInvoice; note?: TaxCreditNote | null; courseTitle: string; siteUrl?: string }) {
  const { invoice, note } = input
  const purchasesUrl = `${learningEmailSiteUrl(input.siteUrl)}/learn/my-learning?tab=purchases`
  const course = input.courseTitle.trim() || 'your Sea N Shore course'
  const subject = note ? `Credit note ${note.creditNoteNumber}` : `Your Sea N Shore tax invoice ${invoice.invoiceNumber}`
  const message = note
    ? `Your purchase of "${course}" was refunded. Credit note ${note.creditNoteNumber} for ${taxMoney(note.totalMinor, invoice.currency)} against invoice ${invoice.invoiceNumber} dated ${taxDocumentDate(invoice.invoiceDate)} is attached as a PDF.`
    : `Thank you for buying "${course}". Your GST tax invoice ${invoice.invoiceNumber} for ${taxMoney(invoice.totalMinor, invoice.currency)} is attached as a PDF.`
  const keep = 'You can download it again at any time from My Learning, under Purchases.'
  const footer = 'Beaufort Marine Services LLP (Sea N Shore), GSTIN ' + invoice.supplier.gstin
  const text = [message, keep, `My purchases: ${purchasesUrl}`, footer].join('\n\n')
  const html = `<!doctype html><html><body style="margin:0;background:#f7fafb;font-family:Arial,Helvetica,sans-serif;color:#102532">
<div style="max-width:600px;margin:0 auto;padding:24px">
<p style="font-weight:bold;color:#071b2d;font-size:18px;margin:0 0 20px">Sea N Shore</p>
<div style="background:#ffffff;border-radius:16px;padding:24px">
<p style="margin:0 0 12px;font-size:16px;line-height:1.6">${escapeHtml(message)}</p>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#33505f">${escapeHtml(keep)}</p>
<p style="margin:0"><a href="${escapeHtml(purchasesUrl)}" style="display:inline-block;background:#075e82;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:10px;font-weight:bold">My purchases</a></p>
</div>
<div style="font-size:12px;color:#607481;padding:16px 4px;line-height:1.5">${escapeHtml(footer)}</div>
</div></body></html>`
  return { subject, text, html }
}

function runtimeTransaction<T>(work: (client: Client) => Promise<T>) {
  return withTransaction((client) => work(client))
}

const BUYER_EMAIL = `(select lower(account.email)
   from public.identity_accounts account
   where account.profile_id = invoice.buyer_profile_id and account.email_verified = true and account.email is not null
   order by account.created_at asc, account.id asc
   limit 1)`
const COURSE_TITLE = `(select o.course_title from public.course_payment_orders o where o.id = invoice.order_id)`

export function createTaxDocumentEmailRepository(input: { transaction?: Transaction } = {}) {
  const transaction = input.transaction ?? runtimeTransaction
  return {
    /** Claims due emails with a 15-minute lease. */
    async claimBatch(limit = 10): Promise<TaxDocumentDelivery[]> {
      const bounded = Math.max(1, Math.min(25, Math.floor(limit)))
      return transaction(async (client) => {
        const result = await client.query<QueryResultRow>(
          `with picked as (
             select email.id
             from public.tax_document_emails email
             where email.status = 'pending' and email.next_attempt_at <= now() and email.attempts < $2
             order by email.next_attempt_at asc, email.id asc
             for update skip locked
             limit $1
           )
           update public.tax_document_emails email
           set attempts = email.attempts + 1, next_attempt_at = now() + interval '15 minutes'
           from picked
           where email.id = picked.id
           returning email.id, email.document_type, email.document_id`,
          [bounded, MAX_ATTEMPTS],
        )
        return result.rows.map((row) => ({
          id: String(row.id),
          documentType: row.document_type === 'credit_note' ? 'credit_note' : 'invoice',
          documentId: String(row.document_id),
        }))
      })
    },

    async loadDocument(delivery: TaxDocumentDelivery): Promise<LoadedDocument | null> {
      return transaction(async (client) => {
        let note: TaxCreditNote | null = null
        let invoiceId = delivery.documentId
        if (delivery.documentType === 'credit_note') {
          const noteRow = (await client.query<QueryResultRow>(`select ${CREDIT_NOTE_COLUMNS} from public.tax_credit_notes note where note.id = $1::uuid`, [delivery.documentId])).rows[0]
          if (!noteRow) return null
          note = mapCreditNote(noteRow)
          invoiceId = note.invoiceId
        }
        const row = (await client.query<QueryResultRow>(
          `select ${INVOICE_COLUMNS}, ${COURSE_TITLE} as course_title, ${BUYER_EMAIL} as buyer_email
           from public.tax_invoices invoice where invoice.id = $1::uuid`,
          [invoiceId],
        )).rows[0]
        if (!row) return null
        return { invoice: mapInvoice(row), note, courseTitle: String(row.course_title ?? ''), email: row.buyer_email ? String(row.buyer_email) : null }
      })
    },

    async markSent(id: string, messageId: string) {
      await transaction((client) => client.query(
        `update public.tax_document_emails
         set status = 'sent', sent_at = now(), resend_message_id = left($2, 200), last_error = null
         where id = $1::uuid`,
        [id, messageId],
      ))
    },

    async markSkipped(id: string, reason: string) {
      await transaction((client) => client.query(
        `update public.tax_document_emails set status = 'skipped', last_error = left($2, 500) where id = $1::uuid`,
        [id, reason],
      ))
    },

    async markFailed(id: string, error: string, retryable: boolean) {
      await transaction((client) => client.query(
        `update public.tax_document_emails
         set status = case when $3 and attempts < $4 then 'pending' else 'failed' end,
             last_error = left($2, 500),
             next_attempt_at = case when $3 and attempts < $4 then now() + make_interval(mins => greatest(5, attempts * 10)) else next_attempt_at end
         where id = $1::uuid`,
        [id, error, retryable, MAX_ATTEMPTS],
      ))
    },
  }
}

/** Provider errors can quote the address; it never goes into the queue row. */
function errorText(error: unknown) {
  const raw = error instanceof ResendApiError ? `${error.code}: ${error.message}` : error instanceof Error ? error.message : 'unknown_error'
  return raw.replace(/[^\s@<>"'`]+@[^\s@<>"'`]+/g, '[email]').slice(0, 500)
}

function base64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString('base64')
}

export function createTaxDocumentEmailWorker(input: {
  resend?: Sender | null
  loadApiKey?: () => Promise<string | null>
  siteUrl?: string
  transaction?: Transaction
  repository?: ReturnType<typeof createTaxDocumentEmailRepository>
} = {}) {
  const repository = input.repository ?? createTaxDocumentEmailRepository({ transaction: input.transaction })
  let client: Sender | null | undefined = input.resend

  async function resolveClient() {
    if (client !== undefined) return client
    const key = await (input.loadApiKey ?? loadResendApiKey)()
    client = key ? withEmailSuppression(createResendEmailClient({ apiKey: key })) : null
    return client
  }

  async function sendOne(delivery: TaxDocumentDelivery, sender: Sender) {
    let document: LoadedDocument | null
    let pdf: Uint8Array
    try {
      document = await repository.loadDocument(delivery)
      if (!document) {
        await repository.markFailed(delivery.id, 'document_missing', false)
        return 'failed' as const
      }
      if (!document.email) {
        await repository.markSkipped(delivery.id, 'no_verified_email')
        return 'skipped' as const
      }
      pdf = document.note ? await buildCreditNotePdf(document.note, document.invoice) : await buildTaxInvoicePdf(document.invoice)
    } catch (error) {
      await repository.markFailed(delivery.id, errorText(error), true)
      return 'retry' as const
    }

    const number = document.note ? document.note.creditNoteNumber : document.invoice.invoiceNumber
    const email = taxDocumentEmail({ invoice: document.invoice, note: document.note, courseTitle: document.courseTitle, siteUrl: input.siteUrl })
    try {
      const result = await sender.sendEmail({
        from: TAX_DOCUMENT_EMAIL_FROM,
        to: document.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        attachments: [{ filename: taxDocumentFileName(number), content: base64(pdf) }],
        idempotencyKey: `tax-document/${delivery.documentType}/${delivery.documentId}`,
        tags: [{ name: 'category', value: delivery.documentType === 'invoice' ? 'tax_invoice' : 'tax_credit_note' }],
      })
      await repository.markSent(delivery.id, result.messageId)
      return 'sent' as const
    } catch (error) {
      const retryable = error instanceof ResendApiError && error.retryable
      await repository.markFailed(delivery.id, errorText(error), retryable)
      return retryable ? 'retry' as const : 'failed' as const
    }
  }

  return {
    async runSweep(limit = 10) {
      const sender = await resolveClient()
      if (!sender) return { claimed: 0, sent: 0, failed: 0, skipped: 0, retrying: 0, disabled: true }
      const deliveries = await repository.claimBatch(limit)
      const counts = { sent: 0, failed: 0, skipped: 0, retrying: 0 }
      for (const delivery of deliveries) {
        const result = await sendOne(delivery, sender)
        if (result === 'sent') counts.sent += 1
        if (result === 'failed') counts.failed += 1
        if (result === 'skipped') counts.skipped += 1
        if (result === 'retry') {
          counts.retrying += 1
          // Rate limit or provider trouble: leave the rest of the batch for the next sweep (their leases expire).
          break
        }
      }
      return { claimed: deliveries.length, ...counts, disabled: false }
    },
  }
}

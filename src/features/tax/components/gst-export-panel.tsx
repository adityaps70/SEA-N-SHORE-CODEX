import { Download } from 'lucide-react'
import { indiaMonth } from '../gst'

export const GST_EXPORT_PATH = '/api/admin/tax/documents'

/** The calendar month before `at` in India, "YYYY-MM": the month usually filed. */
export function previousIndiaMonth(at: Date) {
  const [year, month] = indiaMonth(at).split('-').map(Number) as [number, number]
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`
}

/**
 * C4: download the month's GST invoices and credit notes as CSV (admin tax page). A plain GET form, so it works
 * without client JavaScript; the route checks the administrator and records the export.
 */
export function GstExportPanel({ defaultMonth, now = new Date() }: { defaultMonth?: string; now?: Date }) {
  const month = defaultMonth ?? previousIndiaMonth(now)
  const latest = indiaMonth(now)
  return (
    <section aria-labelledby="gst-export-title" className="rounded-[1.4rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
      <h2 id="gst-export-title" className="text-lg font-bold text-navy-950">GST documents export</h2>
      <p className="mt-1 max-w-2xl text-sm leading-6 text-muted">
        Every tax invoice and credit note dated in the month, as a CSV for GST returns. Amounts are exactly as issued, in each
        document&rsquo;s currency; credit notes are listed as positive amounts.
      </p>
      <form method="get" action={GST_EXPORT_PATH} className="mt-4 flex flex-wrap items-end gap-3">
        <label htmlFor="gst-export-month" className="grid gap-2 text-sm font-medium text-navy-900">
          Month
          <input
            id="gst-export-month"
            name="month"
            type="month"
            required
            defaultValue={month}
            max={latest}
            pattern="[0-9]{4}-[0-9]{2}"
            className="min-h-12 rounded-xl border border-mist-100 bg-white px-4 text-base text-ink shadow-sm focus:border-ocean-700"
          />
        </label>
        <button
          type="submit"
          className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 rounded-xl bg-ocean-700 px-5 text-sm font-semibold text-white transition-colors hover:bg-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2"
        >
          <Download aria-hidden="true" className="size-4" />
          Download CSV
        </button>
      </form>
    </section>
  )
}

'use client'

import { Download } from 'lucide-react'
import { useId, useState } from 'react'
import { primaryButtonClass } from '@/components/ui/interactive-styles'
import { isPeriod, periodLabel } from '../../seller-invoice-rules'
import { adminInputClass } from './fee-settings-form'

type Props = {
  /** The month selected at first (YYYY-MM), usually last month in India: previousMonth(indiaMonth(new Date())). */
  defaultMonth: string
}

/**
 * Admin → Payments → Tax: download the monthly TDS report (CSV) of course payouts created in a month (IST).
 * The download goes through /api/admin/tax/tds, which checks the administrator and audits the export.
 */
export function TdsExportPanel({ defaultMonth }: Props) {
  const [month, setMonth] = useState(isPeriod(defaultMonth) ? defaultMonth : '')
  const id = useId()
  const valid = isPeriod(month)

  return (
    <div className="space-y-3 p-5">
      <div className="grid gap-1.5 sm:max-w-xs">
        <label htmlFor={`${id}-month`} className="text-sm font-semibold text-navy-900">Month</label>
        <input
          id={`${id}-month`}
          type="month"
          value={month}
          onChange={(event) => setMonth(event.target.value)}
          aria-invalid={month !== '' && !valid}
          aria-describedby={`${id}-hint`}
          className={adminInputClass}
        />
        <p id={`${id}-hint`} className={`text-xs leading-5 ${month !== '' && !valid ? 'font-medium text-red-700' : 'text-muted'}`}>
          {month !== '' && !valid ? 'Choose a month, for example September 2026.' : 'Course payouts created in this month (India time), with the PAN, section, rate and TDS of each.'}
        </p>
      </div>
      {valid ? (
        <a href={`/api/admin/tax/tds?month=${encodeURIComponent(month)}`} download className={primaryButtonClass}>
          <Download aria-hidden="true" className="size-4" /> Download TDS report for {periodLabel(month)}
        </a>
      ) : (
        <button type="button" disabled className={primaryButtonClass}>
          <Download aria-hidden="true" className="size-4" /> Download TDS report
        </button>
      )}
      <p className="text-xs leading-5 text-muted">A CSV file for your accountant. Every download is recorded in the payments audit trail.</p>
    </div>
  )
}

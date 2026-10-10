import type { QueryResultRow } from 'pg'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { csvCell } from '@/features/newsletter/csv'
import { indiaDate } from '@/features/tax/gst'
import { isPeriod } from './seller-invoice-rules'
import { formatRateBasisPoints } from './tds'

/**
 * Monthly TDS report for the accountant (C4): every course payout created in a calendar month (IST), with the PAN
 * and TDS stored on the payout when it was created. Payouts that failed, were reversed or cancelled are left out:
 * their earnings went back to the seller's balance and the TDS was worked out again on the payout that paid them.
 * Administrators only; the export is audited.
 */

export type TdsReportRow = {
  payoutId: string
  transferId: string
  createdAt: string
  sellerName: string
  sellerType: 'Organization' | 'Individual'
  pan: string | null
  section: string | null
  rateBasisPoints: number | null
  tdsBaseMinor: number
  tdsMinor: number
  grossMinor: number
  netMinor: number
  status: string
  financialYear: string | null
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

export function indiaMonthRange(month: string) {
  if (!isPeriod(month)) throw new RangeError('month_invalid')
  const [year, monthNumber] = month.split('-').map(Number) as [number, number]
  return {
    from: new Date(Date.UTC(year, monthNumber - 1, 1) - IST_OFFSET_MS),
    to: new Date(Date.UTC(year, monthNumber, 1) - IST_OFFSET_MS),
  }
}

export async function listTdsReportRows(client: Pick<DatabaseQueryClient, 'query'>, month: string): Promise<TdsReportRow[]> {
  const { from, to } = indiaMonthRange(month)
  const result = await client.query<QueryResultRow & Record<string, unknown>>(`
    select po.id, po.transfer_id, po.created_at, po.seller_company_id, po.seller_pan, po.tds_section, po.tds_rate_basis_points,
      po.tds_base_minor, po.tds_minor, coalesce(po.gross_minor, po.amount_minor) as gross_minor, po.amount_minor, po.status,
      po.tds_financial_year,
      coalesce(tp.legal_name, sc.name, sp.full_name) as seller_name
    from public.payouts po
    left join public.profiles sp on sp.id = po.seller_profile_id
    left join public.companies sc on sc.id = po.seller_company_id
    left join public.payout_tax_profiles tp
      on (po.seller_profile_id is not null and tp.seller_profile_id = po.seller_profile_id)
      or (po.seller_company_id is not null and tp.seller_company_id = po.seller_company_id)
    where po.tds_financial_year is not null
      and po.status in ('draft', 'processing', 'success')
      and po.created_at >= $1::timestamptz and po.created_at < $2::timestamptz
    order by po.created_at asc, po.id asc
  `, [from.toISOString(), to.toISOString()])
  return result.rows.map((row) => ({
    payoutId: String(row.id),
    transferId: String(row.transfer_id),
    createdAt: new Date(row.created_at as string).toISOString(),
    sellerName: String(row.seller_name ?? (row.seller_company_id ? 'Organization' : 'Former member')),
    sellerType: row.seller_company_id ? 'Organization' : 'Individual',
    pan: (row.seller_pan as string | null) ?? null,
    section: (row.tds_section as string | null) ?? null,
    rateBasisPoints: row.tds_rate_basis_points === null || row.tds_rate_basis_points === undefined ? null : Number(row.tds_rate_basis_points),
    tdsBaseMinor: Number(row.tds_base_minor ?? 0),
    tdsMinor: Number(row.tds_minor ?? 0),
    grossMinor: Number(row.gross_minor ?? 0),
    netMinor: Number(row.amount_minor ?? 0),
    status: String(row.status),
    financialYear: (row.tds_financial_year as string | null) ?? null,
  }))
}

/** "423750" → "4237.50" (plain rupees, no grouping, so spreadsheets read it as a number). */
export function rupees(minor: number) {
  const negative = minor < 0
  const absolute = Math.abs(minor)
  return `${negative ? '-' : ''}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

const STATUS_LABELS: Record<string, string> = { draft: 'Being sent', processing: 'Processing', success: 'Paid' }

const COLUMNS: Array<[string, (row: TdsReportRow) => string | null]> = [
  ['Payout date', (row) => indiaDate(new Date(row.createdAt))],
  ['Payout ID', (row) => row.payoutId],
  ['Transfer ID', (row) => row.transferId],
  ['Seller name', (row) => row.sellerName],
  ['Seller type', (row) => row.sellerType],
  ['PAN', (row) => row.pan],
  ['Section', (row) => row.section],
  ['Rate %', (row) => (row.rateBasisPoints === null ? null : formatRateBasisPoints(row.rateBasisPoints).replace('%', ''))],
  ['Course amount (TDS base)', (row) => rupees(row.tdsBaseMinor)],
  ['TDS deducted', (row) => rupees(row.tdsMinor)],
  ['Gross paid', (row) => rupees(row.grossMinor)],
  ['Net transferred', (row) => rupees(row.netMinor)],
  ['Status', (row) => STATUS_LABELS[row.status] ?? row.status],
  ['Financial year', (row) => row.financialYear],
]

export function tdsReportToCsv(rows: TdsReportRow[]) {
  const header = COLUMNS.map(([name]) => csvCell(name)).join(',')
  const lines = rows.map((row) => COLUMNS.map(([, read]) => csvCell(read(row))).join(','))
  return `﻿${[header, ...lines].join('\r\n')}\r\n`
}

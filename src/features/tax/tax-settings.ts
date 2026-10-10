import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import { recordPaymentAudit } from '@/features/payments/audit'
import { financialYearOf } from './gst'

/**
 * Platform tax settings (C4): the TDS section, rate and yearly threshold on course-seller payouts
 * (public.platform_tax_settings), and the GST LUT ARN per financial year (public.gst_lut_registrations).
 * Every change is recorded in payment_audit_events.
 */

export type TaxSettings = {
  tdsSection: string
  /** Null until an administrator sets it; no course payout can be sent while it is null. */
  tdsRateBasisPoints: number | null
  /** Null until set: TDS applies once a seller's financial-year total passes this. */
  tdsThresholdMinor: number | null
  updatedAt: string | null
}

export type LutRegistration = { financialYear: string; arn: string; updatedAt: string }

type Client = Pick<DatabaseQueryClient, 'query'>

const DEFAULTS: TaxSettings = { tdsSection: '194J', tdsRateBasisPoints: null, tdsThresholdMinor: null, updatedAt: null }

function numberOrNull(value: unknown) {
  if (value === null || value === undefined) return null
  const numeric = Number(value)
  return Number.isFinite(numeric) ? numeric : null
}

async function rows(client: Client | undefined, text: string, values?: unknown[]) {
  if (client) return (await client.query<QueryResultRow>(text, values)).rows
  return databaseQuery<QueryResultRow>(text, values)
}

export async function getTaxSettings(client?: Client): Promise<TaxSettings> {
  const [row] = await rows(client, `select tds_section, tds_rate_basis_points, tds_threshold_minor, updated_at from public.platform_tax_settings where id`)
  if (!row) return DEFAULTS
  return {
    tdsSection: String(row.tds_section ?? '194J'),
    tdsRateBasisPoints: numberOrNull(row.tds_rate_basis_points),
    tdsThresholdMinor: numberOrNull(row.tds_threshold_minor),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
  }
}

export async function updateTdsSettings(
  tx: DatabaseQueryClient,
  input: { section: string; rateBasisPoints: number | null; thresholdMinor: number | null; actorProfileId: string },
) {
  const before = await getTaxSettings(tx)
  await tx.query(
    `insert into public.platform_tax_settings (id, tds_section, tds_rate_basis_points, tds_threshold_minor, updated_by, updated_at)
     values (true, $1, $2, $3, $4::uuid, now())
     on conflict (id) do update
       set tds_section = excluded.tds_section, tds_rate_basis_points = excluded.tds_rate_basis_points,
           tds_threshold_minor = excluded.tds_threshold_minor, updated_by = excluded.updated_by, updated_at = now()`,
    [input.section, input.rateBasisPoints, input.thresholdMinor, input.actorProfileId],
  )
  await recordPaymentAudit(tx, {
    actorType: 'admin',
    actorProfileId: input.actorProfileId,
    subjectType: 'platform_tax_settings',
    subjectId: 'default',
    action: 'tds_settings_updated',
    details: {
      before: { section: before.tdsSection, rateBasisPoints: before.tdsRateBasisPoints, thresholdMinor: before.tdsThresholdMinor },
      after: { section: input.section, rateBasisPoints: input.rateBasisPoints, thresholdMinor: input.thresholdMinor },
    },
  })
}

export async function listLutRegistrations(client?: Client): Promise<LutRegistration[]> {
  const result = await rows(client, `select financial_year, arn, updated_at from public.gst_lut_registrations order by financial_year desc limit 20`)
  return result.map((row) => ({ financialYear: String(row.financial_year), arn: String(row.arn), updatedAt: new Date(String(row.updated_at)).toISOString() }))
}

/** The LUT ARN for the financial year an instant falls in, or null when none is saved (USD sales stay off). */
export async function lutForDate(at: Date, client?: Client) {
  const [row] = await rows(client, `select arn from public.gst_lut_registrations where financial_year = $1`, [financialYearOf(at)])
  return row ? String(row.arn) : null
}

export async function saveLutRegistration(tx: DatabaseQueryClient, input: { financialYear: string; arn: string; actorProfileId: string }) {
  const previous = (await tx.query<QueryResultRow>(`select arn from public.gst_lut_registrations where financial_year = $1`, [input.financialYear])).rows[0]
  await tx.query(
    `insert into public.gst_lut_registrations (financial_year, arn, updated_by, updated_at)
     values ($1, $2, $3::uuid, now())
     on conflict (financial_year) do update set arn = excluded.arn, updated_by = excluded.updated_by, updated_at = now()`,
    [input.financialYear, input.arn, input.actorProfileId],
  )
  await recordPaymentAudit(tx, {
    actorType: 'admin',
    actorProfileId: input.actorProfileId,
    subjectType: 'gst_lut_registration',
    subjectId: input.financialYear,
    action: 'lut_saved',
    details: { before: previous ? String(previous.arn) : null, after: input.arn },
  })
}

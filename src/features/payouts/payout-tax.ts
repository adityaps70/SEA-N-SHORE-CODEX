import type { QueryResultRow } from 'pg'
import type { DatabaseQueryClient } from '@/lib/db/client'
import { recordPaymentAudit } from '@/features/payments/audit'
import type { Seller } from '@/features/payments/earnings'
import { financialYearOf, isValidGstin, normaliseGstin, normalisePan, PAN_PATTERN } from '@/features/tax/gst'
import { getTaxSettings, type TaxSettings } from '@/features/tax/tax-settings'
import { courseEarningSql } from './course-payable'
import { computePayoutTds, maskPan, type TdsResult } from './tds'

/**
 * Seller tax details (public.payout_tax_profiles) and the TDS plan of a course payout (C4).
 * The PAN is read only by the payout code, the seller's own settings page and the admin TDS report; it is never
 * logged and never written to the audit trail (the audit records only that it changed).
 */

type Client = Pick<DatabaseQueryClient, 'query'>

function sellerColumns(seller: Seller): [string | null, string | null] {
  if (seller.companyId) return [null, seller.companyId]
  if (seller.profileId) return [seller.profileId, null]
  throw new RangeError('seller_required')
}

const SELLER_MATCH = `(($1::uuid is not null and seller_profile_id = $1::uuid) or ($2::uuid is not null and seller_company_id = $2::uuid))`

// ---------------------------------------------------------------------------
// Tax details
// ---------------------------------------------------------------------------

export type PayoutTaxProfile = {
  legalName: string
  pan: string
  gstRegistered: boolean
  gstin: string | null
  updatedAt: string
}

/** What the seller's settings page may show: the PAN masked, and the GSTIN with the PAN inside it masked too. */
export type MaskedPayoutTaxProfile = Omit<PayoutTaxProfile, 'pan' | 'gstin'> & { maskedPan: string; maskedGstin: string | null }

/** "27ABCDE1234F1Z5" → "27ABCDE****F1Z5" (a GSTIN carries its holder's PAN in characters 3 to 12). */
export function maskGstin(gstin: string) {
  return gstin.length === 15 ? `${gstin.slice(0, 2)}${maskPan(gstin.slice(2, 12))}${gstin.slice(12)}` : '***************'
}

export function maskTaxProfile(profile: PayoutTaxProfile): MaskedPayoutTaxProfile {
  const { pan, gstin, ...rest } = profile
  return { ...rest, maskedPan: maskPan(pan), maskedGstin: gstin ? maskGstin(gstin) : null }
}

type ProfileRow = QueryResultRow & { legal_name: string; pan: string; gst_registered: boolean; gstin: string | null; updated_at: string | Date }

export async function getPayoutTaxProfile(client: Client, seller: Seller, options: { lock?: boolean } = {}): Promise<PayoutTaxProfile | null> {
  const [profileId, companyId] = sellerColumns(seller)
  const result = await client.query<ProfileRow>(`
    select legal_name, pan, gst_registered, gstin, updated_at from public.payout_tax_profiles
    where ${SELLER_MATCH}
    limit 1
    ${options.lock ? 'for update' : ''}
  `, [profileId, companyId])
  const row = result.rows[0]
  if (!row) return null
  return {
    legalName: row.legal_name,
    pan: row.pan,
    gstRegistered: Boolean(row.gst_registered),
    gstin: row.gstin ?? null,
    updatedAt: new Date(row.updated_at).toISOString(),
  }
}

export type TaxProfileInput = { legalName: string; pan: string; gstRegistered: boolean; gstin: string | null }
export type TaxProfileFieldErrors = Partial<Record<'legalName' | 'pan' | 'gstRegistered' | 'gstin', string>>

export const LEGAL_NAME_MESSAGE = 'Enter the name exactly as it appears on the PAN card (2 to 180 characters).'
export const PAN_MESSAGE = 'Enter the 10-character PAN, for example ABCDE1234F: 5 letters, 4 digits, then a letter.'
export const GSTIN_MESSAGE = 'Enter a valid 15-character GSTIN, for example 27ABCDE1234F1Z5. Check it on your GST registration certificate.'
export const GSTIN_PAN_MESSAGE = 'This GSTIN belongs to a different PAN. A GSTIN contains the PAN of its holder (characters 3 to 12).'

/** Checks the tax details form. The PAN and GSTIN are upper-cased and stripped of spaces. */
export function parseTaxProfileInput(raw: { legalName?: unknown; pan?: unknown; gstRegistered?: unknown; gstin?: unknown }):
  | { ok: true; input: TaxProfileInput }
  | { ok: false; fieldErrors: TaxProfileFieldErrors } {
  const fieldErrors: TaxProfileFieldErrors = {}
  const legalName = typeof raw.legalName === 'string' ? raw.legalName.trim().replace(/\s+/g, ' ') : ''
  if (legalName.length < 2 || legalName.length > 180) fieldErrors.legalName = LEGAL_NAME_MESSAGE
  const pan = typeof raw.pan === 'string' ? normalisePan(raw.pan) : ''
  if (!PAN_PATTERN.test(pan)) fieldErrors.pan = PAN_MESSAGE
  const registered = raw.gstRegistered === true || raw.gstRegistered === 'yes' || raw.gstRegistered === 'true'
  const unregistered = raw.gstRegistered === false || raw.gstRegistered === 'no' || raw.gstRegistered === 'false'
  if (!registered && !unregistered) fieldErrors.gstRegistered = 'Tell us whether you are registered for GST.'
  let gstin: string | null = null
  if (registered) {
    gstin = typeof raw.gstin === 'string' ? normaliseGstin(raw.gstin) : ''
    if (!isValidGstin(gstin)) fieldErrors.gstin = GSTIN_MESSAGE
    else if (PAN_PATTERN.test(pan) && gstin.slice(2, 12) !== pan) fieldErrors.gstin = GSTIN_PAN_MESSAGE
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors }
  return { ok: true, input: { legalName, pan, gstRegistered: registered, gstin } }
}

/** Saves (creates or replaces) the seller's tax details. Audited without the PAN, GSTIN or name. */
export async function savePayoutTaxProfile(tx: DatabaseQueryClient, input: TaxProfileInput & { seller: Seller; actorProfileId: string }) {
  const [profileId, companyId] = sellerColumns(input.seller)
  const before = await getPayoutTaxProfile(tx, input.seller, { lock: true })
  if (before) {
    await tx.query(`
      update public.payout_tax_profiles
      set legal_name = $3::text, pan = $4::text, gst_registered = $5::boolean, gstin = $6::text, updated_by = $7::uuid, updated_at = now()
      where ${SELLER_MATCH}
    `, [profileId, companyId, input.legalName, input.pan, input.gstRegistered, input.gstin, input.actorProfileId])
  } else {
    await tx.query(`
      insert into public.payout_tax_profiles (seller_profile_id, seller_company_id, legal_name, pan, gst_registered, gstin, updated_by)
      values ($1::uuid, $2::uuid, $3::text, $4::text, $5::boolean, $6::text, $7::uuid)
    `, [profileId, companyId, input.legalName, input.pan, input.gstRegistered, input.gstin, input.actorProfileId])
  }
  await recordPaymentAudit(tx, {
    actorType: 'member',
    actorProfileId: input.actorProfileId,
    subjectType: 'payout_tax_profile',
    subjectId: companyId ?? profileId!,
    action: before ? 'payout_tax_profile_updated' : 'payout_tax_profile_added',
    // Only what changed, never the PAN, GSTIN or legal name themselves.
    details: {
      sellerType: companyId ? 'organization' : 'profile',
      panChanged: !before || before.pan !== input.pan,
      legalNameChanged: !before || before.legalName !== input.legalName,
      gstRegistered: input.gstRegistered,
      gstinChanged: (before?.gstin ?? null) !== input.gstin,
    },
  })
  return maskTaxProfile({ legalName: input.legalName, pan: input.pan, gstRegistered: input.gstRegistered, gstin: input.gstin, updatedAt: new Date().toISOString() })
}

// ---------------------------------------------------------------------------
// TDS plan of a payout
// ---------------------------------------------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** The instants a financial year ("2026-27") starts and ends: 1 April 00:00 IST to the next 1 April. */
export function financialYearRange(financialYear: string) {
  const start = Number(financialYear.slice(0, 4))
  if (!/^[0-9]{4}-[0-9]{2}$/.test(financialYear) || !Number.isInteger(start)) throw new RangeError('financial_year_invalid')
  return {
    from: new Date(Date.UTC(start, 3, 1) - IST_OFFSET_MS),
    to: new Date(Date.UTC(start + 1, 3, 1) - IST_OFFSET_MS),
  }
}

/**
 * The course part of the seller's earlier payouts in the financial year that are processing or paid, and the TDS
 * deducted from them. The course part of a payout is the sum of its course items (course sales and course refund
 * adjustments), read from payout_items, so payouts made before C4 count too.
 */
export async function getFinancialYearCourseTotals(client: Client, seller: Seller, financialYear: string) {
  const [profileId, companyId] = sellerColumns(seller)
  const { from, to } = financialYearRange(financialYear)
  const result = await client.query<QueryResultRow & { course_minor: string | number; tds_minor: string | number }>(`
    select coalesce(sum(t.course_part), 0) as course_minor, coalesce(sum(t.tds_minor), 0) as tds_minor
    from (
      select po.tds_minor,
        coalesce((
          select sum(i.amount_minor) from public.payout_items i
          join public.seller_earnings e on e.id = i.earning_id
          where i.payout_id = po.id and ${courseEarningSql('e')}
        ), 0) as course_part
      from public.payouts po
      where ((($1::uuid is not null and po.seller_profile_id = $1::uuid) or ($2::uuid is not null and po.seller_company_id = $2::uuid)))
        and po.status in ('processing', 'success')
        and (po.tds_financial_year = $3::text or (po.tds_financial_year is null and po.created_at >= $4::timestamptz and po.created_at < $5::timestamptz))
    ) t
  `, [profileId, companyId, financialYear, from.toISOString(), to.toISOString()])
  const row = result.rows[0]
  return { earlierCourseMinor: Number(row?.course_minor ?? 0), earlierTdsMinor: Number(row?.tds_minor ?? 0) }
}

export type PayoutTaxBlocker = 'tds_rate_unset' | 'pan_missing'

export type PayoutTaxPlan = {
  grossMinor: number
  coursePartMinor: number
  /** False for a payout with no positive course part (event earnings only): no TDS, no PAN needed. */
  applies: boolean
  blocker: PayoutTaxBlocker | null
  section: string | null
  rateBasisPoints: number | null
  thresholdMinor: number | null
  financialYear: string | null
  /** Only for the payout row itself; never shown in full. */
  pan: string | null
  tds: TdsResult | null
  tdsMinor: number
  netMinor: number
}

/**
 * Works out the TDS of a payout before it is created. Used by createPayout (inside its transaction) and the admin
 * review screen, so both show and deduct the same amount.
 */
export async function planPayoutTax(client: Client, input: {
  seller: Seller
  grossMinor: number
  coursePartMinor: number
  now: Date
  settings?: TaxSettings
}): Promise<PayoutTaxPlan> {
  const base = {
    grossMinor: input.grossMinor,
    coursePartMinor: input.coursePartMinor,
    section: null,
    rateBasisPoints: null,
    thresholdMinor: null,
    financialYear: null,
    pan: null,
    tds: null,
    tdsMinor: 0,
    netMinor: input.grossMinor,
  }
  if (input.coursePartMinor <= 0) return { ...base, applies: false, blocker: null }

  const settings = input.settings ?? await getTaxSettings(client)
  const financialYear = financialYearOf(input.now)
  const common = { ...base, applies: true, section: settings.tdsSection, rateBasisPoints: settings.tdsRateBasisPoints, thresholdMinor: settings.tdsThresholdMinor, financialYear }
  if (settings.tdsRateBasisPoints === null) return { ...common, blocker: 'tds_rate_unset' }
  const profile = await getPayoutTaxProfile(client, input.seller)
  if (!profile) return { ...common, blocker: 'pan_missing' }

  const totals = await getFinancialYearCourseTotals(client, input.seller, financialYear)
  const tds = computePayoutTds({
    coursePartMinor: input.coursePartMinor,
    earlierCourseMinor: totals.earlierCourseMinor,
    earlierTdsMinor: totals.earlierTdsMinor,
    rateBasisPoints: settings.tdsRateBasisPoints,
    thresholdMinor: settings.tdsThresholdMinor,
  })
  return { ...common, blocker: null, pan: profile.pan, tds, tdsMinor: tds.tdsMinor, netMinor: input.grossMinor - tds.tdsMinor }
}

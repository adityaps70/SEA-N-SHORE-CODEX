/**
 * GST for course sales (C4). Sea N Shore (Beaufort Marine Services LLP) supplies every course. Course prices include
 * GST: the tax is worked back out of the price paid, per invoice, in paise, and the parts always add up to the price.
 *
 * Place of supply is the buyer's billing state: Maharashtra (the supplier's state) is an intra-state supply (CGST 9% +
 * SGST 9%), any other state is inter-state (IGST 18%). A buyer outside India paying in USD is a zero-rated export under
 * LUT (0% GST); it needs an LUT ARN saved for the financial year.
 */

export const GST_SUPPLIER = {
  legalName: 'Beaufort Marine Services LLP',
  tradeName: 'Sea N Shore',
  gstin: '27AASFB2030K1ZE',
  registration: 'Regular',
  address: ['0502, Hermes Hiranandani Fortune City', 'Bhokarpada, Panvel, Raigad', 'Maharashtra 410206'],
  stateCode: '27',
  stateName: 'Maharashtra',
} as const

export type GstSupplier = typeof GST_SUPPLIER

/** Commercial training and coaching services. */
export const COURSE_SAC = '999293'
/** 18% in basis points. */
export const COURSE_GST_RATE_BASIS_POINTS = 1800

/** Indian states and union territories with their GST state codes. */
export const GST_STATES = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'], ['05', 'Uttarakhand'],
  ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'], ['10', 'Bihar'], ['11', 'Sikkim'],
  ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'], ['15', 'Mizoram'], ['16', 'Tripura'],
  ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'], ['20', 'Jharkhand'], ['21', 'Odisha'],
  ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'], ['26', 'Dadra and Nagar Haveli and Daman and Diu'],
  ['27', 'Maharashtra'], ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'], ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'], ['38', 'Ladakh'],
] as const satisfies ReadonlyArray<readonly [string, string]>

export type GstStateCode = (typeof GST_STATES)[number][0]

/** Place-of-supply code for exports (GSTR-1 "Other country"). */
export const EXPORT_PLACE_OF_SUPPLY = { code: '96', name: 'Outside India (export)' } as const

export function gstStateName(code: string | null | undefined) {
  return GST_STATES.find(([value]) => value === code)?.[1] ?? null
}

export function isGstStateCode(code: unknown): code is GstStateCode {
  return typeof code === 'string' && GST_STATES.some(([value]) => value === code)
}

const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/
const GSTIN_CHARSET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** The GSTIN check character (mod 36, the scheme used by the GST network). */
export function gstinCheckCharacter(first14: string) {
  let sum = 0
  for (let index = 0; index < 14; index += 1) {
    const value = GSTIN_CHARSET.indexOf(first14[index]!)
    if (value < 0) return null
    const product = value * (index % 2 === 0 ? 1 : 2)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return GSTIN_CHARSET[(36 - (sum % 36)) % 36]!
}

export function normaliseGstin(value: string) {
  return value.replace(/\s+/g, '').toUpperCase()
}

/** A GSTIN of the right shape, a real state code and a correct check character. */
export function isValidGstin(value: string) {
  const gstin = normaliseGstin(value)
  if (!GSTIN_PATTERN.test(gstin)) return false
  if (!isGstStateCode(gstin.slice(0, 2)) && gstin.slice(0, 2) !== '97') return false
  return gstinCheckCharacter(gstin.slice(0, 14)) === gstin[14]
}

export const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/

export function normalisePan(value: string) {
  return value.replace(/\s+/g, '').toUpperCase()
}

export type SupplyType = 'intra_state' | 'inter_state' | 'export_lut'

export type GstBreakup = {
  supplyType: SupplyType
  rateBasisPoints: number
  totalMinor: number
  taxableMinor: number
  cgstMinor: number
  sgstMinor: number
  igstMinor: number
}

export function supplyTypeFor(input: { currency: 'INR' | 'USD'; billingStateCode: string | null }): SupplyType {
  if (input.currency === 'USD') return 'export_lut'
  return input.billingStateCode === GST_SUPPLIER.stateCode ? 'intra_state' : 'inter_state'
}

/**
 * Works GST back out of a GST-inclusive price. Taxable value = price ÷ 1.18, rounded half-up to the paisa; the tax is
 * the rest, so taxable + tax always equals the price paid. Intra-state tax is split into CGST and SGST (CGST takes the
 * odd paisa). An export under LUT carries no GST.
 */
export function gstBreakup(totalMinor: number, supplyType: SupplyType): GstBreakup {
  if (!Number.isSafeInteger(totalMinor) || totalMinor <= 0) throw new Error('gst_total_invalid')
  if (supplyType === 'export_lut') {
    return { supplyType, rateBasisPoints: 0, totalMinor, taxableMinor: totalMinor, cgstMinor: 0, sgstMinor: 0, igstMinor: 0 }
  }
  const rate = COURSE_GST_RATE_BASIS_POINTS
  // Half-up rounding of total × 10000 / (10000 + rate), in integers.
  const taxableMinor = Math.floor((totalMinor * 10_000 * 2 + (10_000 + rate)) / (2 * (10_000 + rate)))
  const taxMinor = totalMinor - taxableMinor
  if (supplyType === 'inter_state') {
    return { supplyType, rateBasisPoints: rate, totalMinor, taxableMinor, cgstMinor: 0, sgstMinor: 0, igstMinor: taxMinor }
  }
  const cgstMinor = Math.ceil(taxMinor / 2)
  return { supplyType, rateBasisPoints: rate, totalMinor, taxableMinor, cgstMinor, sgstMinor: taxMinor - cgstMinor, igstMinor: 0 }
}

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

/** The calendar date in India (YYYY-MM-DD) of an instant. */
export function indiaDate(at: Date) {
  return new Date(at.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10)
}

/** The Indian financial year (1 April – 31 March, in IST) of an instant, as "2026-27". */
export function financialYearOf(at: Date) {
  const [year, month] = indiaDate(at).split('-').map(Number) as [number, number]
  const start = month >= 4 ? year : year - 1
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`
}

/** "2026-27" → "26-27", as used in document numbers. */
export function shortFinancialYear(financialYear: string) {
  return `${financialYear.slice(2, 4)}-${financialYear.slice(5, 7)}`
}

export function invoiceNumber(financialYear: string, sequence: number) {
  return `SNS/${shortFinancialYear(financialYear)}/${String(sequence).padStart(6, '0')}`
}

/** Credit notes have their own series; "SNC/26-27/000001" keeps within GST's 16-character limit. */
export function creditNoteNumber(financialYear: string, sequence: number) {
  return `SNC/${shortFinancialYear(financialYear)}/${String(sequence).padStart(6, '0')}`
}

/** The calendar month in India (YYYY-MM) of an instant, the period of a seller invoice. */
export function indiaMonth(at: Date) {
  return indiaDate(at).slice(0, 7)
}

/** "INR 4,237.29" / "USD 49.00": tax documents print the currency code (built-in PDF fonts have no ₹ sign). */
export function taxMoney(minor: number, currency: 'INR' | 'USD') {
  const value = (minor / 100).toLocaleString(currency === 'INR' ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return `${currency} ${value}`
}

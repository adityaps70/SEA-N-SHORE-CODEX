import { z } from 'zod'
import { gstStateName, isGstStateCode, isValidGstin, normaliseGstin } from './gst'

/**
 * Billing details asked at course checkout (C4). They decide the GST on the invoice:
 * - INR purchases: the billing state is required (place of supply); a company name and GSTIN are optional (B2B).
 * - USD purchases: a buyer outside India; the billing country is required (export under LUT).
 */

export type BillingInput = {
  stateCode?: string | null
  country?: string | null
  company?: string | null
  gstin?: string | null
}

export type OrderBilling = {
  stateCode: string | null
  country: string | null
  company: string | null
  gstin: string | null
}

export type BillingRefusal =
  | 'billing_state_required'
  | 'billing_country_required'
  | 'billing_company_invalid'
  | 'billing_gstin_invalid'
  | 'billing_gstin_state_mismatch'
  | 'billing_gstin_company_required'

export const billingInputSchema = z.object({
  stateCode: z.string().trim().max(2).nullable().optional(),
  country: z.string().trim().max(2).nullable().optional(),
  company: z.string().trim().max(200).nullable().optional(),
  gstin: z.string().trim().max(30).nullable().optional(),
}).nullable().optional()

/** Countries a USD buyer can choose (ISO 3166 codes); "ZZ" is any other country outside India. */
export const BILLING_COUNTRIES = [
  ['AE', 'United Arab Emirates'], ['AU', 'Australia'], ['BD', 'Bangladesh'], ['BH', 'Bahrain'], ['CA', 'Canada'],
  ['CN', 'China'], ['CY', 'Cyprus'], ['DE', 'Germany'], ['DK', 'Denmark'], ['EG', 'Egypt'], ['ES', 'Spain'],
  ['FR', 'France'], ['GB', 'United Kingdom'], ['GR', 'Greece'], ['HK', 'Hong Kong'], ['ID', 'Indonesia'],
  ['IE', 'Ireland'], ['IT', 'Italy'], ['JP', 'Japan'], ['KE', 'Kenya'], ['KR', 'South Korea'], ['KW', 'Kuwait'],
  ['LK', 'Sri Lanka'], ['MM', 'Myanmar'], ['MT', 'Malta'], ['MY', 'Malaysia'], ['NG', 'Nigeria'], ['NL', 'Netherlands'],
  ['NO', 'Norway'], ['NP', 'Nepal'], ['NZ', 'New Zealand'], ['OM', 'Oman'], ['PA', 'Panama'], ['PH', 'Philippines'],
  ['PK', 'Pakistan'], ['PL', 'Poland'], ['QA', 'Qatar'], ['RO', 'Romania'], ['SA', 'Saudi Arabia'], ['SE', 'Sweden'],
  ['SG', 'Singapore'], ['TH', 'Thailand'], ['TR', 'Turkey'], ['UA', 'Ukraine'], ['US', 'United States'],
  ['VN', 'Vietnam'], ['ZA', 'South Africa'], ['ZZ', 'Other country'],
] as const

export function billingCountryName(code: string | null | undefined) {
  return BILLING_COUNTRIES.find(([value]) => value === code)?.[1] ?? null
}

/** Checks the billing details for an order in `currency`. The order stores only what applies to it. */
export function resolveOrderBilling(input: BillingInput | null | undefined, currency: 'INR' | 'USD'):
  | { ok: true; billing: OrderBilling }
  | { ok: false; reason: BillingRefusal } {
  const company = input?.company?.trim() || null
  if (company && (company.length < 2 || company.length > 120)) return { ok: false, reason: 'billing_company_invalid' }
  if (currency === 'USD') {
    const country = input?.country?.trim().toUpperCase() || null
    if (!country || !billingCountryName(country)) return { ok: false, reason: 'billing_country_required' }
    return { ok: true, billing: { stateCode: null, country, company, gstin: null } }
  }
  const stateCode = input?.stateCode?.trim() || null
  if (!isGstStateCode(stateCode)) return { ok: false, reason: 'billing_state_required' }
  const rawGstin = input?.gstin ? normaliseGstin(input.gstin) : ''
  if (!rawGstin) return { ok: true, billing: { stateCode, country: null, company, gstin: null } }
  if (!isValidGstin(rawGstin)) return { ok: false, reason: 'billing_gstin_invalid' }
  if (rawGstin.slice(0, 2) !== stateCode) return { ok: false, reason: 'billing_gstin_state_mismatch' }
  if (!company) return { ok: false, reason: 'billing_gstin_company_required' }
  return { ok: true, billing: { stateCode, country: null, company, gstin: rawGstin } }
}

export function billingRefusalMessage(reason: BillingRefusal) {
  switch (reason) {
    case 'billing_state_required':
      return 'Choose your billing state. It decides the GST on your invoice.'
    case 'billing_country_required':
      return 'Choose your billing country.'
    case 'billing_company_invalid':
      return 'Enter the company name as it appears on its GST registration (2 to 120 characters).'
    case 'billing_gstin_invalid':
      return 'This GSTIN is not valid. Check it, or leave it empty to buy without a business invoice.'
    case 'billing_gstin_state_mismatch':
      return 'This GSTIN is registered in another state. Choose the state of the GST registration.'
    case 'billing_gstin_company_required':
      return 'Enter the company name for this GSTIN.'
  }
}

export function sameBilling(a: OrderBilling, b: OrderBilling) {
  return a.stateCode === b.stateCode && a.country === b.country && a.company === b.company && a.gstin === b.gstin
}

export function billingSummary(billing: OrderBilling) {
  if (billing.country) return billingCountryName(billing.country) ?? billing.country
  return [billing.company, gstStateName(billing.stateCode), billing.gstin ? `GSTIN ${billing.gstin}` : null].filter(Boolean).join(' · ')
}

import { GST_SUPPLIER } from '@/features/tax/gst'

/**
 * Who runs Sea N Shore — the one source of truth for the business details shown on the
 * Contact, Terms, Privacy, Refund, Shipping and Pricing pages and in every footer.
 * Payment-gateway reviewers (Cashfree KYC) compare these with the KYC business, so keep
 * them exactly as registered.
 *
 * Round H (H7): `registeredAddress` comes from the one source already printed on every GST
 * invoice (GST_SUPPLIER in src/features/tax/gst.ts), so the Contact page and the invoices
 * can never disagree. OWNER TO-DO: fill `llpin` and `gstin` once they are confirmed (copy
 * them exactly from the LLP registration / GST certificate); empty fields are never rendered.
 * Grievance officer fields are optional: when empty, the support email is shown instead. The
 * Contact page's Grievance Officer is edited in Admin › Site settings.
 *
 * Pure data, safe to import from client and server code.
 */
export type BusinessDetails = {
  brandName: string
  brandTagline: string
  legalName: string
  city: string
  region: string
  country: string
  /** Full registered postal address on one line. '' until confirmed. */
  registeredAddress: string
  email: string
  phone: { display: string; tel: string }
  /** LLP Identification Number. '' until confirmed. */
  llpin: string
  /** GST number. '' until confirmed. */
  gstin: string
  supportHours: string
  responseTime: string
  grievanceOfficer: { name: string; email: string; phone: string }
}

/** The registered office as printed on GST invoices, on one line, with the country. */
export function registeredAddressLine(lines: readonly string[] = GST_SUPPLIER.address, country = 'India') {
  return [...lines, country].map((line) => line.trim()).filter(Boolean).join(', ')
}

export const BUSINESS: BusinessDetails = {
  brandName: 'Sea N Shore',
  brandTagline: 'Global Shipping Community',
  legalName: 'Beaufort Marine Services LLP',
  city: 'Navi Mumbai',
  region: 'Maharashtra',
  country: 'India',
  registeredAddress: registeredAddressLine(),
  email: 'info@beaufortmarine.in',
  phone: { display: '+91 85914 63321', tel: '+918591463321' },
  llpin: '',
  gstin: '',
  supportHours: 'Monday to Saturday, 10:00–18:00 IST',
  responseTime: 'within 2 working days',
  grievanceOfficer: { name: '', email: '', phone: '' },
}

/** The registered address when known, otherwise "Navi Mumbai, Maharashtra, India". */
export function businessAddressLine(business: BusinessDetails = BUSINESS) {
  const address = business.registeredAddress.trim()
  return address || [business.city, business.region, business.country].filter(Boolean).join(', ')
}

/** "Sea N Shore is operated by Beaufort Marine Services LLP · Navi Mumbai, India" */
export function operatorLine(business: BusinessDetails = BUSINESS) {
  return `${business.brandName} is operated by ${business.legalName} · ${business.city}, ${business.country}`
}

export const OPERATOR_LINE = operatorLine()

/** Registration numbers that are filled in, in display order. */
export function businessRegistrations(business: BusinessDetails = BUSINESS) {
  return [
    { label: 'LLPIN', value: business.llpin.trim() },
    { label: 'GSTIN', value: business.gstin.trim() },
  ].filter((entry) => entry.value)
}

/** Grievance contact; falls back to the support email and phone when not set. */
export function grievanceContact(business: BusinessDetails = BUSINESS) {
  const officer = business.grievanceOfficer
  return {
    name: officer.name.trim(),
    email: officer.email.trim() || business.email,
    phone: officer.phone.trim(),
  }
}

export function telHref(tel: string) {
  return `tel:${tel.replace(/[^+\d]/g, '')}`
}

import { PAYMENT_CURRENCIES, type PaymentCurrency } from './types'

export const DEFAULT_PAYMENT_CURRENCY: PaymentCurrency = 'INR'

/** Both supported currencies use two decimal places (paise / cents). */
const MINOR_UNITS: Record<PaymentCurrency, number> = { INR: 100, USD: 100 }

/** Smallest and largest ticket prices accepted, in major units. */
export const MIN_TICKET_PRICE = 1
export const MAX_TICKET_PRICE = 500000

export const CURRENCY_LABELS: Record<PaymentCurrency, string> = {
  INR: 'INR – Indian rupee (₹)',
  USD: 'USD – US dollar ($)',
}

export function isPaymentCurrency(value: unknown): value is PaymentCurrency {
  return typeof value === 'string' && PAYMENT_CURRENCIES.some((currency) => currency === value)
}

/**
 * Parse a price the organiser typed (e.g. "499", "499.50", "1,499") into minor units.
 * Returns null when the text is empty or not a valid amount with at most two decimals.
 */
export function parsePriceToMinor(value: string, currency: PaymentCurrency = DEFAULT_PAYMENT_CURRENCY): number | null {
  const normalized = value.trim().replace(/[,\s]/g, '')
  if (!normalized) return null
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return Number.NaN
  const [whole, fraction = ''] = normalized.split('.')
  const factor = MINOR_UNITS[currency]
  return Number(whole) * factor + Number(fraction.padEnd(2, '0'))
}

export function minorToPriceInput(amountMinor: number | null | undefined, currency: PaymentCurrency = DEFAULT_PAYMENT_CURRENCY) {
  if (amountMinor === null || amountMinor === undefined || !Number.isFinite(amountMinor)) return ''
  const factor = MINOR_UNITS[currency]
  const whole = Math.floor(amountMinor / factor)
  const fraction = amountMinor % factor
  return fraction ? `${whole}.${String(fraction).padStart(2, '0')}` : String(whole)
}

export function formatMoney(amountMinor: number, currency: string) {
  const code = isPaymentCurrency(currency) ? currency : DEFAULT_PAYMENT_CURRENCY
  const major = amountMinor / MINOR_UNITS[code]
  return new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: Number.isInteger(major) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(major)
}

export function minTicketPriceMinor(currency: PaymentCurrency) {
  return MIN_TICKET_PRICE * MINOR_UNITS[currency]
}

export function maxTicketPriceMinor(currency: PaymentCurrency) {
  return MAX_TICKET_PRICE * MINOR_UNITS[currency]
}

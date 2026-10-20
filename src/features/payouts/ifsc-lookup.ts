/**
 * Hotfix P1: the bank and branch for an IFSC, shown under the IFSC field and checked before Cashfree is called.
 *
 * The branch comes from Razorpay's free public IFSC service (an IFSC is a public branch code, not personal data;
 * nothing else is sent). When that service is down, the bank still comes from the IFSC's first four letters for
 * the common banks, and saving goes ahead (Cashfree checks the IFSC too). Only a definite "no such IFSC" stops a save.
 */

export type IfscLookup =
  | { status: 'found'; bank: string; branch: string | null; city: string | null }
  | { status: 'not_found' }
  | { status: 'unavailable'; bank: string | null }

export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/
export const IFSC_NOT_FOUND_MESSAGE = "We couldn't find this IFSC. Check it on your cheque book or in your bank app."

/** Bank names by the IFSC's first four letters (RBI bank codes), for when the lookup service can't be reached. */
export const BANK_BY_CODE: Record<string, string> = {
  ABHY: 'Abhyudaya Co-operative Bank', AIRP: 'Airtel Payments Bank', AUBL: 'AU Small Finance Bank', BARB: 'Bank of Baroda',
  BDBL: 'Bandhan Bank', BKID: 'Bank of India', CBIN: 'Central Bank of India', CITI: 'Citibank', CIUB: 'City Union Bank',
  CNRB: 'Canara Bank', COSB: 'Cosmos Co-operative Bank', CSBK: 'CSB Bank', DBSS: 'DBS Bank India', DLXB: 'Dhanlaxmi Bank',
  ESFB: 'Equitas Small Finance Bank', FDRL: 'Federal Bank', FINO: 'Fino Payments Bank', HDFC: 'HDFC Bank', HSBC: 'HSBC',
  IBKL: 'IDBI Bank', ICIC: 'ICICI Bank', IDFB: 'IDFC FIRST Bank', IDIB: 'Indian Bank', INDB: 'IndusInd Bank',
  IOBA: 'Indian Overseas Bank', IPOS: 'India Post Payments Bank', JAKA: 'Jammu & Kashmir Bank', JSFB: 'Jana Small Finance Bank',
  KARB: 'Karnataka Bank', KKBK: 'Kotak Mahindra Bank', KVBL: 'Karur Vysya Bank', MAHB: 'Bank of Maharashtra',
  PSIB: 'Punjab & Sind Bank', PUNB: 'Punjab National Bank', PYTM: 'Paytm Payments Bank', RATN: 'RBL Bank',
  SBIN: 'State Bank of India', SCBL: 'Standard Chartered Bank', SIBL: 'South Indian Bank', SRCB: 'Saraswat Co-operative Bank',
  TJSB: 'TJSB Sahakari Bank', TMBL: 'Tamilnad Mercantile Bank', UBIN: 'Union Bank of India', UCBA: 'UCO Bank',
  UJVN: 'Ujjivan Small Finance Bank', UTIB: 'Axis Bank', YESB: 'Yes Bank',
}

const LOOKUP_URL = 'https://ifsc.razorpay.com/'
const TIMEOUT_MS = 3_000
const CACHE_TTL_MS = 24 * 60 * 60_000
const CACHE_LIMIT = 500

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

function cleanText(value: unknown, max = 80) {
  if (typeof value !== 'string') return null
  const text = value.replace(/\s+/g, ' ').trim()
  return text ? text.slice(0, max) : null
}

export function createIfscLookup(options: { fetchImpl?: FetchLike; now?: () => number } = {}) {
  const fetchImpl = options.fetchImpl ?? fetch
  const now = options.now ?? Date.now
  const cache = new Map<string, { value: IfscLookup; expiresAt: number }>()

  return async function lookupIfsc(raw: string): Promise<IfscLookup> {
    const ifsc = raw.replace(/\s/g, '').toUpperCase()
    if (!IFSC_PATTERN.test(ifsc)) return { status: 'not_found' }
    const hit = cache.get(ifsc)
    if (hit && hit.expiresAt > now()) return hit.value
    const fallback: IfscLookup = { status: 'unavailable', bank: BANK_BY_CODE[ifsc.slice(0, 4)] ?? null }

    let value: IfscLookup
    try {
      const response = await fetchImpl(`${LOOKUP_URL}${ifsc}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(TIMEOUT_MS), cache: 'no-store' })
      if (response.status === 404) {
        value = { status: 'not_found' }
      } else if (!response.ok) {
        return fallback
      } else {
        const payload = await response.json() as Record<string, unknown>
        const bank = cleanText(payload.BANK) ?? BANK_BY_CODE[ifsc.slice(0, 4)] ?? null
        if (!bank || cleanText(payload.IFSC)?.toUpperCase() !== ifsc) return fallback
        value = { status: 'found', bank, branch: cleanText(payload.BRANCH), city: cleanText(payload.CITY ?? payload.DISTRICT) }
      }
    } catch {
      return fallback
    }
    if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string)
    cache.set(ifsc, { value, expiresAt: now() + CACHE_TTL_MS })
    return value
  }
}

export const lookupIfsc = createIfscLookup()

/** "HDFC Bank · Fort, Mumbai" for the line under the IFSC field. */
export function describeIfsc(result: IfscLookup) {
  if (result.status === 'found') {
    const place = [result.branch, result.city].filter(Boolean).filter((part, index, parts) => parts.indexOf(part) === index).join(', ')
    return place ? `${result.bank} · ${place}` : result.bank
  }
  if (result.status === 'unavailable' && result.bank) return result.bank
  return null
}

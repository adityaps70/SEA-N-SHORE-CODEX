import type { JobListing } from './types'

type SalaryFields = Pick<JobListing, 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'>

/** 1 LPA (lakh per annum) = ₹1,00,000 a year. */
const LAKH = 100_000

const PERIOD_SUFFIX = { day: '/day', month: '/month', year: '/year' } as const

/** What employers type instead of the ISO code. */
const CURRENCY_ALIASES: Record<string, string> = { RS: 'INR', 'RS.': 'INR', RUPEES: 'INR', '₹': 'INR', $: 'USD', 'US$': 'USD' }

/** The ISO code to format with: blank → USD (as before), a known alias, a valid code; null when unknown. */
function salaryCurrency(raw: string | null): string | null {
  const text = (raw ?? '').trim().toUpperCase()
  if (!text) return 'USD'
  const code = CURRENCY_ALIASES[text] ?? text
  if (!/^[A-Z]{3}$/.test(code)) return null
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: code })
    return code
  } catch {
    return null
  }
}

type MoneyParts = { prefix: string; number: string; suffix: string; text: string }

/** "₹39,000" → prefix "₹", number "39,000"; "CHF 1,000" → prefix "CHF ", so a range can name the currency once. */
function moneyParts(amount: number, code: string): MoneyParts {
  const format = new Intl.NumberFormat(code === 'INR' ? 'en-IN' : 'en-US', {
    style: 'currency',
    currency: code,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: Number.isInteger(amount) ? 0 : 2,
  })
  const parts = format.formatToParts(amount)
  const numeric = new Set(['integer', 'group', 'decimal', 'fraction'])
  const first = parts.findIndex((part) => numeric.has(part.type))
  const last = parts.length - 1 - [...parts].reverse().findIndex((part) => numeric.has(part.type))
  const join = (from: number, to: number) => parts.slice(from, to).map((part) => part.value).join('')
  return { prefix: join(0, first), number: join(first, last + 1), suffix: join(last + 1, parts.length), text: format.format(amount) }
}

function range(low: MoneyParts, high: MoneyParts) {
  return low.prefix === high.prefix && low.suffix === high.suffix
    ? `${low.prefix}${low.number}–${high.number}${high.suffix}`
    : `${low.text}–${high.text}`
}

/** 450000 → "4.5", 600000 → "6", 1234567 → "12.35". */
function lakhs(amount: number) {
  return String(Math.round((amount / LAKH) * 100) / 100)
}

function plainNumber(amount: number) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(amount)
}

/**
 * Round H (H7): the one salary line for every job surface (cards, job page, similar jobs).
 * - Annual INR of a lakh or more in LPA: "₹39–50 LPA", "₹4.5–6 LPA".
 * - Other INR amounts with Indian grouping: "₹39,000/month", "₹39,00,000/month".
 * - Other currencies with en-US grouping, the symbol once: "$6,000–8,000/month".
 * - Min equal to max is one value ("$240/day"); only a minimum is "From …", only a maximum "Up to …".
 * Returns null when the job gives no salary. JobPosting structured data keeps its numbers (job-seo).
 */
export function formatSalaryRange(job: SalaryFields): string | null {
  const present = [job.salaryMin, job.salaryMax].filter((value): value is number => value !== null && Number.isFinite(value))
  if (!present.length) return null
  const low = Math.min(...present)
  const high = Math.max(...present)
  const single = low === high
  const lead = job.salaryMin !== null && job.salaryMax !== null ? '' : job.salaryMin !== null ? 'From ' : 'Up to '
  const code = salaryCurrency(job.salaryCurrency)
  const period = job.salaryPeriod ? PERIOD_SUFFIX[job.salaryPeriod] : ''

  if (!code) {
    const amount = single ? plainNumber(low) : `${plainNumber(low)}–${plainNumber(high)}`
    return `${lead}${(job.salaryCurrency ?? '').trim()} ${amount}${period}`
  }
  if (code === 'INR' && job.salaryPeriod === 'year' && low >= LAKH) {
    const [from, to] = [lakhs(low), lakhs(high)]
    return `${lead}₹${from === to ? from : `${from}–${to}`} LPA`
  }
  const amount = single ? moneyParts(low, code).text : range(moneyParts(low, code), moneyParts(high, code))
  return `${lead}${amount}${period}`
}

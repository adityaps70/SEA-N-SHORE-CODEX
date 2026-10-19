import { formatLifecycleDate } from '@/features/jobs/job-lifecycle'
import { formatSalaryRange } from '@/features/jobs/salary'
import type { JobSalaryPeriod } from '@/features/jobs/types'
import { SOCIAL_HANDLE_LABELS, SOCIAL_HANDLE_NETWORKS, type SocialHandles } from '@/features/site-settings/schemas'
import { SHARE_FACTS, SHARE_LABELS, type ShareFact, type ShareOptions } from './share-options'

/**
 * Round I (I1): what the job share image says, built only from the job's saved fields and Admin › Site settings.
 * Empty fields never show. No job id or reference, and no phone number or email of the poster, is ever on it.
 */
export type ShareJob = {
  id: string
  title: string
  companyName: string
  companyId: string | null
  companyLogoPath: string | null
  location: string | null
  salaryMin: number | null
  salaryMax: number | null
  salaryCurrency: string | null
  salaryPeriod: JobSalaryPeriod | null
  publishedAt: string | null
  createdAt: string
  updatedAt: string
  urgent: boolean
  vesselTypes: string[]
  experienceMinYears: number | null
  experienceMaxYears: number | null
  joiningFrom: string | null
  joiningUntil: string | null
  applyUntil: string | null
  /** The job was posted by a Sea N Shore platform administrator (for the partner strip). */
  postedByPlatformAdmin: boolean
}

export type SharePartner = { name: string; logoPath: string | null }

export type ShareSettings = { socials: SocialHandles; partners: SharePartner[] }

export type ShareContent = {
  label: string
  title: string
  company: { name: string; logoPath: string | null; initials: string }
  chips: Array<{ kind: 'location' | 'salary' | 'posted'; text: string }>
  facts: Array<{ key: ShareFact; label: string; value: string }>
  /** Partner logos, only on jobs posted by a platform administrator or by Beaufort Marine Services LLP. */
  partners: SharePartner[]
  footer: { siteHost: string; socials: string[] }
  /** The job page with ?src=share_image, for the QR code and the caption; null when the QR is switched off. */
  qrUrl: string | null
  applyUrl: string
}

/** The partner strip's poster rule: a platform administrator's job, or Beaufort Marine Services LLP's. */
export function isPartnerStripPoster(job: Pick<ShareJob, 'companyName' | 'postedByPlatformAdmin'>) {
  return job.postedByPlatformAdmin || /^beaufort\s+marine\s+services(\s+llp)?\.?$/i.test(job.companyName.trim())
}

export function companyInitials(name: string) {
  const words = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean)
  const initials = words.filter((word) => !/^(pvt|ltd|llp|limited|private|inc|co)$/i.test(word)).slice(0, 2).map((word) => [...word][0]!.toUpperCase())
  return initials.join('') || '•'
}

/** A timestamp's date in India Standard Time, as the one site-wide date style ("19 Oct 2026"). */
export function shareDate(value: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return formatLifecycleDate(value)
  const ist = new Date(new Date(value).getTime() + 330 * 60_000)
  return formatLifecycleDate(ist.toISOString().slice(0, 10))
}

function experience(job: Pick<ShareJob, 'experienceMinYears' | 'experienceMaxYears'>) {
  const { experienceMinYears: min, experienceMaxYears: max } = job
  const years = (value: number) => `${value} ${value === 1 ? 'year' : 'years'}`
  if (min !== null && max !== null && max > min) return `${min}–${years(max)}`
  if (min !== null && min > 0) return `${years(min)}+`
  if (min === 0 && (max === null || max === 0)) return 'Freshers welcome'
  if (max !== null) return `Up to ${years(max)}`
  return null
}

function joining(job: Pick<ShareJob, 'joiningFrom' | 'joiningUntil'>) {
  if (!job.joiningFrom) return null
  const from = shareDate(job.joiningFrom)
  return job.joiningUntil && job.joiningUntil !== job.joiningFrom ? `${from} – ${shareDate(job.joiningUntil)}` : from
}

export function factValues(job: ShareJob): Record<ShareFact, string | null> {
  const vessels = job.vesselTypes.map((value) => value.trim()).filter(Boolean)
  return {
    joining: joining(job),
    experience: experience(job),
    vessel: vessels.length ? vessels.slice(0, 2).join(', ') + (vessels.length > 2 ? ` +${vessels.length - 2}` : '') : null,
    apply_by: job.applyUntil ? shareDate(job.applyUntil) : null,
  }
}

export function socialLine(socials: SocialHandles) {
  return SOCIAL_HANDLE_NETWORKS.filter((network) => socials[network]).map((network) => `${SOCIAL_HANDLE_LABELS[network]} @${socials[network]}`)
}

export function buildShareContent(job: ShareJob, options: ShareOptions, settings: ShareSettings, siteUrl: string): ShareContent {
  const origin = new URL(siteUrl).origin
  const applyUrl = `${origin}/jobs/${job.id}?src=share_image`
  const salary = options.salary ? formatSalaryRange(job) : null
  const values = factValues(job)
  const chips: ShareContent['chips'] = []
  if (job.location?.trim()) chips.push({ kind: 'location', text: job.location.trim() })
  if (salary) chips.push({ kind: 'salary', text: salary })
  chips.push({ kind: 'posted', text: `Posted ${shareDate(job.publishedAt ?? job.createdAt)}` })
  return {
    label: SHARE_LABELS[options.label],
    title: job.title.trim(),
    company: { name: job.companyName.trim(), logoPath: job.companyLogoPath, initials: companyInitials(job.companyName) },
    chips,
    facts: options.facts.flatMap((key) => (values[key] ? [{ key, label: SHARE_FACTS[key], value: values[key]! }] : [])),
    partners: isPartnerStripPoster(job) ? settings.partners.filter((partner) => partner.logoPath) : [],
    footer: { siteHost: new URL(siteUrl).host, socials: socialLine(settings.socials) },
    qrUrl: options.qr ? applyUrl : null,
    applyUrl,
  }
}

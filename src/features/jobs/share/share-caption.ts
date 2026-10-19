import { formatSalaryRange } from '@/features/jobs/salary'
import type { ShareJob } from './share-content'
import { SHARE_LABELS, type ShareOptions } from './share-options'

/**
 * Round I (I1): the caption offered with the share image (the poster can edit it before copying or posting) and
 * the image's alt text. Plain words and the job's own fields only; no emojis (the poster may add their own).
 */
export type CaptionJob = Pick<ShareJob, 'id' | 'title' | 'companyName' | 'location' | 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod' | 'vesselTypes'> & {
  rank: string | null
  domain: 'sea' | 'shore'
}

function tag(words: string) {
  const cleaned = words
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => (/^[A-Z0-9]{2,}$/.test(word) ? word : word[0]!.toUpperCase() + word.slice(1).toLowerCase()))
    .join('')
  return cleaned.length >= 2 && cleaned.length <= 40 ? `#${cleaned}` : null
}

/** 3 to 5 hashtags: the rank (or title), the first vessel types, then the general maritime ones. */
export function shareHashtags(job: CaptionJob) {
  const tags = [
    tag(job.rank ?? job.title.split(/[–—\-(,|]/)[0] ?? ''),
    ...job.vesselTypes.slice(0, 2).map((vessel) => tag(`${vessel} jobs`)),
    job.domain === 'shore' ? '#ShoreJobs' : '#SeafarerJobs',
    '#MaritimeJobs',
    '#SeaNShore',
  ]
  const unique = [...new Set(tags.filter((value): value is string => Boolean(value)))]
  return unique.slice(0, 5)
}

export function shareCaption(job: CaptionJob, options: Pick<ShareOptions, 'label' | 'salary'>, applyUrl: string) {
  const salary = options.salary ? formatSalaryRange(job) : null
  const lines = [
    `${SHARE_LABELS[options.label]}: ${job.title}`,
    [job.companyName, job.location?.trim()].filter(Boolean).join(' · '),
    salary ? `Salary: ${salary}` : null,
    `Apply on Sea N Shore: ${applyUrl}`,
    '',
    shareHashtags(job).join(' '),
  ]
  return lines.filter((line) => line !== null).join('\n')
}

export function shareAltText(job: CaptionJob, options: Pick<ShareOptions, 'label' | 'salary'>) {
  const salary = options.salary ? formatSalaryRange(job) : null
  return [
    `${SHARE_LABELS[options.label]}: ${job.title} at ${job.companyName}`,
    job.location?.trim() ? `in ${job.location.trim()}` : null,
    salary ? `Salary ${salary}` : null,
  ].filter(Boolean).join(', ') + '. Apply on Sea N Shore.'
}

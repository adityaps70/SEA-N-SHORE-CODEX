/**
 * Round I (I1): the choices of the job share image. Every value is a fixed key, so a URL can only ask for what the
 * panel offers: /api/jobs/<id>/share-image?size=portrait&look=navy&opts=label:urgent_hiring;badge:coral;salary:on;qr:on;facts:joining+experience
 */
export const SHARE_SIZES = {
  square: { width: 1080, height: 1080, label: 'Square 1080 × 1080' },
  portrait: { width: 1080, height: 1350, label: 'Portrait 1080 × 1350' },
  story: { width: 1080, height: 1920, label: 'Story 1080 × 1920' },
  linkedin: { width: 1200, height: 627, label: 'LinkedIn 1200 × 627' },
} as const
export type ShareSize = keyof typeof SHARE_SIZES
export const SHARE_SIZE_KEYS = Object.keys(SHARE_SIZES) as ShareSize[]

export const SHARE_LOOK_KEYS = ['sky', 'navy', 'teal', 'midnight', 'white'] as const
export type ShareLook = (typeof SHARE_LOOK_KEYS)[number]

export const SHARE_BADGE_KEYS = ['coral', 'amber', 'emerald', 'ocean'] as const
export type ShareBadge = (typeof SHARE_BADGE_KEYS)[number]

export const SHARE_LABELS = {
  now_hiring: 'Now hiring',
  immediate_joining: 'Immediate joining',
  urgent_hiring: 'Urgent hiring',
  multiple_openings: 'Multiple openings',
} as const
export type ShareLabel = keyof typeof SHARE_LABELS
export const SHARE_LABEL_KEYS = Object.keys(SHARE_LABELS) as ShareLabel[]

/**
 * The Job Details facts the poster can switch on or off (up to four; a fact with no value never shows). The job has
 * no contract-duration field, so the fourth fact is the apply-by date.
 */
export const SHARE_FACTS = {
  joining: 'Joining',
  experience: 'Experience',
  vessel: 'Vessel type',
  apply_by: 'Apply by',
} as const
export type ShareFact = keyof typeof SHARE_FACTS
export const SHARE_FACT_KEYS = Object.keys(SHARE_FACTS) as ShareFact[]

export type ShareOptions = {
  size: ShareSize
  look: ShareLook
  label: ShareLabel
  badge: ShareBadge
  salary: boolean
  qr: boolean
  facts: ShareFact[]
}

/** "Urgent hiring" for an urgent job, otherwise "Now hiring". */
export function defaultShareLabel(job: { urgent: boolean }): ShareLabel {
  return job.urgent ? 'urgent_hiring' : 'now_hiring'
}

export function defaultShareOptions(job: { urgent: boolean }): ShareOptions {
  return { size: 'portrait', look: 'navy', label: defaultShareLabel(job), badge: 'coral', salary: true, qr: true, facts: [...SHARE_FACT_KEYS] }
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : null
}

/** Reads size, look and opts from a URL; anything unknown falls back to the job's defaults. */
export function parseShareOptions(params: URLSearchParams, job: { urgent: boolean }): ShareOptions {
  const defaults = defaultShareOptions(job)
  const options: ShareOptions = {
    ...defaults,
    size: oneOf(params.get('size'), SHARE_SIZE_KEYS) ?? defaults.size,
    look: oneOf(params.get('look'), SHARE_LOOK_KEYS) ?? defaults.look,
  }
  for (const part of (params.get('opts') ?? '').slice(0, 300).split(';')) {
    const [key, value = ''] = part.split(':')
    if (key === 'label') options.label = oneOf(value, SHARE_LABEL_KEYS) ?? options.label
    if (key === 'badge') options.badge = oneOf(value, SHARE_BADGE_KEYS) ?? options.badge
    if (key === 'salary') options.salary = value !== 'off'
    if (key === 'qr') options.qr = value !== 'off'
    if (key === 'facts') {
      const wanted = new Set(value.split('+'))
      options.facts = SHARE_FACT_KEYS.filter((fact) => wanted.has(fact))
    }
  }
  return options
}

/** The opts value for a URL, always in the same order (it is part of the image's cache key). */
export function serializeShareOpts(options: Pick<ShareOptions, 'label' | 'badge' | 'salary' | 'qr' | 'facts'>) {
  const facts = SHARE_FACT_KEYS.filter((fact) => options.facts.includes(fact))
  return [
    `label:${options.label}`,
    `badge:${options.badge}`,
    `salary:${options.salary ? 'on' : 'off'}`,
    `qr:${options.qr ? 'on' : 'off'}`,
    `facts:${facts.join('+')}`,
  ].join(';')
}

export function shareImagePath(jobId: string, options: ShareOptions, extra: Record<string, string> = {}) {
  const params = new URLSearchParams({ size: options.size, look: options.look, opts: serializeShareOpts(options), ...extra })
  return `/api/jobs/${jobId}/share-image?${params.toString()}`
}

/**
 * Round G (G0.3): every scorer returns a score plus the reasons behind it. Reasons drive the
 * "Why am I seeing this?" and card reason lines; `parts` are the score's factors for the admin
 * ?rankdebug=1 view. Reason text only states what the viewer can already see on the site.
 */
export type RankReason = {
  /** Stable machine code, for example 'connection' or 'popular_with_rank'. */
  code: string
  /** One plain sentence for the member. */
  text: string
}

export type ScoreParts = Record<string, number>

export type Scored<T> = {
  item: T
  score: number
  reasons: RankReason[]
  parts: ScoreParts
}

/** Debug data for one ranked item on the admin ?rankdebug=1 overlay. */
export type RankDebug = {
  version: string
  score: number
  parts: ScoreParts
  reasons: string[]
}

export function roundScore(value: number, places = 4) {
  const factor = 10 ** places
  return Math.round(value * factor) / factor
}

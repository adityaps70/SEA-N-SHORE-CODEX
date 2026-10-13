/** Round G: the ranking switch areas and modes, without any server code (safe for client components). */
export const RANKING_AREAS = [
  'feed',
  'people',
  'jobs',
  'search',
  'suggestions',
  'notifications',
  'job_alerts',
  'weekly_digest',
] as const
export type RankingArea = (typeof RANKING_AREAS)[number]

export const RANKING_MODES = ['off', 'admins', 'everyone'] as const
export type RankingMode = (typeof RANKING_MODES)[number]

export const RANKING_AREA_LABELS: Record<RankingArea, { title: string; off: string }> = {
  feed: { title: 'Home feed: Top for you', off: 'Newest first, connections first inside each page (v1)' },
  people: { title: 'People you may know', off: 'Profile-match suggestions with the hotfix exclusions (v1)' },
  jobs: { title: 'Jobs for you', off: 'The 60 most recent jobs scored in the app (v1)' },
  search: { title: 'Search', off: 'Per-vertical LIKE search (v1)' },
  suggestions: { title: 'Pages, communities, events and courses suggestions', off: 'The same lists for everyone (v1)' },
  notifications: { title: 'Notification grouping', off: 'One row per notification (v1)' },
  job_alerts: { title: 'Job alert emails', off: 'No alert emails are sent' },
  weekly_digest: { title: 'Weekly digest email', off: 'No digest emails are sent' },
}

export function isRankingArea(value: unknown): value is RankingArea {
  return (RANKING_AREAS as readonly unknown[]).includes(value)
}

export function isRankingMode(value: unknown): value is RankingMode {
  return (RANKING_MODES as readonly unknown[]).includes(value)
}


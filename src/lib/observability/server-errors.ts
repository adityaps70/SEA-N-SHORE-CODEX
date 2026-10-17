import { emitMetric } from './emf'

/**
 * Round H (H1): which part of the site a failing request belonged to. These are the dimension values
 * of the ServerErrors metric, one alarm each for the key APIs.
 */
export type ServerErrorArea = 'feed' | 'impressions' | 'messaging' | 'jobs' | 'learning' | 'payments-webhooks' | 'other'

export function serverErrorArea(path: string): ServerErrorArea {
  const pathname = (path.split('?')[0] ?? '').toLowerCase()
  if (pathname.startsWith('/api/feed/impressions')) return 'impressions'
  if (/^\/api\/payments\/.*webhook/.test(pathname) || /^\/api\/[a-z-]+\/webhooks?\b/.test(pathname)) return 'payments-webhooks'
  if (pathname.startsWith('/api/feed') || pathname.startsWith('/api/feed-media') || pathname === '/home' || pathname.startsWith('/posts')) return 'feed'
  if (pathname.startsWith('/api/messages') || pathname.startsWith('/api/realtime') || pathname.startsWith('/messages')) return 'messaging'
  if (pathname.startsWith('/api/jobs') || pathname.startsWith('/jobs') || pathname.startsWith('/hiring')) return 'jobs'
  if (pathname.startsWith('/api/learn') || pathname.startsWith('/learn')) return 'learning'
  return 'other'
}

/** One server error: counted per area and in total (the "app" alarm). Nothing about the member. */
export function recordServerError(path: string, write?: (line: string) => void) {
  emitMetric({
    dimensions: { Area: serverErrorArea(path) },
    metrics: { ServerErrors: { value: 1 } },
    rollups: [[]],
  }, write)
}

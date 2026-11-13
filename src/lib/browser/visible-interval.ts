/**
 * Round P3: runs `callback` every `intervalMs` while the page is visible and returns a stop
 * function. A hidden tab makes no requests at all; when it is shown again the callback runs at once
 * if a tick is overdue. Every open tab used to poll on a fixed 30 s timer whether anyone was looking.
 */
export function startVisibleInterval(callback: () => void, intervalMs: number): () => void {
  let lastRun = Date.now()
  const hidden = () => document.visibilityState === 'hidden'
  const run = () => {
    lastRun = Date.now()
    callback()
  }
  const interval = window.setInterval(() => {
    if (!hidden()) run()
  }, intervalMs)
  const onVisibilityChange = () => {
    if (!hidden() && Date.now() - lastRun >= intervalMs) run()
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  return () => {
    window.clearInterval(interval)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }
}

/** How often the notification bell and list check for new notifications. */
export const NOTIFICATION_POLL_MS = 60_000
/** How often a feed checks whether newer posts are waiting above the first one. */
export const FEED_FRESH_POSTS_POLL_MS = 90_000
/**
 * Round CAP (finding 5): the same check while the realtime socket is connected. New posts from the member's network
 * arrive as hints within seconds; the timer only catches posts from outside it.
 */
export const FEED_FRESH_POSTS_CONNECTED_POLL_MS = 5 * 60_000

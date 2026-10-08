const RELOAD_GUARD_KEY = 'sns:stale-asset-reload'
const RELOAD_GUARD_WINDOW_MS = 60_000

/**
 * True when an error means the browser is still running the previous build after a deploy:
 * it asked for a JavaScript chunk the server no longer has (Next.js `ChunkLoadError`), or it
 * submitted a form to a Server Action the new build does not have (`UnrecognizedActionError`,
 * logged on the server as "Failed to find Server Action"). One reload fixes both.
 */
export function isStaleAssetError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const { name, message } = error as { name?: unknown; message?: unknown }
  if (name === 'ChunkLoadError' || name === 'UnrecognizedActionError') return true
  if (typeof message !== 'string') return false
  return /Failed to load chunk|Loading chunk [\w-]+ failed|Loading CSS chunk|Server Action "[^"]*" was not found on the server/i.test(message)
}

type ReloadableWindow = Pick<Window, 'location'> & { sessionStorage?: Pick<Storage, 'getItem' | 'setItem'> }

/**
 * Reloads the page once so the browser picks up the current build. Returns
 * false (and does nothing) if a reload was already attempted within the last
 * minute, which prevents an infinite loop when the asset is genuinely missing.
 */
export function recoverFromStaleAssets(target: ReloadableWindow, now = Date.now()): boolean {
  let lastAttempt = 0
  try {
    lastAttempt = Number(target.sessionStorage?.getItem(RELOAD_GUARD_KEY) ?? 0)
  } catch {
    lastAttempt = 0
  }
  if (Number.isFinite(lastAttempt) && lastAttempt > 0 && now - lastAttempt < RELOAD_GUARD_WINDOW_MS) return false

  try {
    target.sessionStorage?.setItem(RELOAD_GUARD_KEY, String(now))
  } catch {
    // Storage may be unavailable (private mode); reloading once is still safe.
  }
  target.location.reload()
  return true
}

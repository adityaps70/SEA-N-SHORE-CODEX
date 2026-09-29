/** Browser helpers for sharing a job link (used by client components only). */

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed'

export function jobShareUrl(jobId: string, origin = typeof window === 'undefined' ? '' : window.location.origin) {
  return `${origin}/jobs/${jobId}`
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the textarea fallback below.
  }
  try {
    const field = document.createElement('textarea')
    field.value = text
    field.setAttribute('readonly', '')
    field.style.position = 'fixed'
    field.style.opacity = '0'
    document.body.appendChild(field)
    field.select()
    const copied = document.execCommand?.('copy') ?? false
    field.remove()
    return copied
  } catch {
    return false
  }
}

/** Opens the system share sheet when the browser has one, otherwise copies the link. */
export async function shareLink(input: { title: string; text?: string; url: string }): Promise<ShareOutcome> {
  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: input.title, text: input.text, url: input.url })
      return 'shared'
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return 'cancelled'
      // Some browsers expose share() but refuse it (e.g. insecure context); copy instead.
    }
  }
  return (await copyText(input.url)) ? 'copied' : 'failed'
}

export const SHARE_OUTCOME_MESSAGE: Record<ShareOutcome, string> = {
  shared: 'Shared.',
  copied: 'Link copied.',
  cancelled: '',
  failed: 'Could not copy the link. Copy it from the address bar instead.',
}

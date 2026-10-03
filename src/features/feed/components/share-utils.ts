'use client'

export type FeedNotice = {
  text: string
  tone: 'success' | 'error'
  /** Optional follow-up link, e.g. to the conversation a post was sent to. */
  href?: string
  hrefLabel?: string
  /** Optional inline action, e.g. Undo. */
  action?: { label: string; onClick(): void }
}

type OptionalNativeShare = {
  share?: (data?: ShareData) => Promise<void>
  canShare?: (data?: ShareData) => boolean
}

export function postPermalink(postId: string) {
  return new URL(`/posts/${postId}`, window.location.origin).toString()
}

export function nativeShareAvailable() {
  if (typeof navigator === 'undefined') return false
  return typeof (navigator as unknown as OptionalNativeShare).share === 'function'
}

/** Opens the device share sheet. Resolves to 'shared', 'cancelled' or 'unavailable'. */
export async function shareWithDevice(data: ShareData): Promise<'shared' | 'cancelled' | 'unavailable'> {
  const nav = navigator as unknown as OptionalNativeShare
  if (typeof nav.share !== 'function') return 'unavailable'
  if (typeof nav.canShare === 'function' && !nav.canShare(data)) return 'unavailable'
  try {
    await nav.share.call(navigator, data)
    return 'shared'
  } catch (error) {
    // AbortError means the member closed the sheet; anything else means the browser refused.
    return error instanceof DOMException && error.name === 'AbortError' ? 'cancelled' : 'unavailable'
  }
}

function legacyCopy(text: string) {
  const field = document.createElement('textarea')
  field.value = text
  field.setAttribute('readonly', '')
  field.style.position = 'fixed'
  field.style.opacity = '0'
  document.body.appendChild(field)
  field.select()
  let copied = false
  try {
    copied = typeof document.execCommand === 'function' && document.execCommand('copy')
  } catch {
    copied = false
  }
  field.remove()
  return copied
}

/** Copies text with the async clipboard API, falling back to a hidden textarea. */
export async function copyToClipboard(text: string) {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Permission denied or insecure context: try the legacy path below.
  }
  return legacyCopy(text)
}

/** Share targets offered when the browser has no native share sheet. */
export function externalShareTargets(url: string, text: string) {
  const encodedUrl = encodeURIComponent(url)
  const encodedText = encodeURIComponent(text)
  return [
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${encodeURIComponent(`${text} ${url}`)}` },
    { id: 'linkedin', label: 'LinkedIn', href: `https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}` },
    { id: 'x', label: 'X (Twitter)', href: `https://twitter.com/intent/tweet?url=${encodedUrl}&text=${encodedText}` },
    { id: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${encodedUrl}` },
    { id: 'email', label: 'Email', href: `mailto:?subject=${encodeURIComponent('A post on Sea N Shore')}&body=${encodeURIComponent(`${text}\n\n${url}`)}` },
  ] as const
}

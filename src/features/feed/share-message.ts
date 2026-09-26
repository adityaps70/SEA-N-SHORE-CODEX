import { headers } from 'next/headers'

/** Absolute origin for links sent in messages. Prefers the configured site URL. */
async function siteOrigin() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL
  if (configured) {
    try {
      return new URL(configured).origin
    } catch {
      // Fall through to the request host.
    }
  }
  try {
    const requestHeaders = await headers()
    const host = requestHeaders.get('x-forwarded-host') ?? requestHeaders.get('host')
    if (!host) return ''
    const protocol = requestHeaders.get('x-forwarded-proto') ?? 'https'
    return `${protocol}://${host}`
  } catch {
    return ''
  }
}

export async function postShareUrl(postId: string) {
  return `${await siteOrigin()}/posts/${postId}`
}

export function composeSharedPostMessage(input: { note: string; authorName: string; url: string }) {
  const note = input.note.trim()
  const reference = `${input.authorName}'s post on Sea N Shore:\n${input.url}`
  return note ? `${note}\n\n${reference}` : reference
}

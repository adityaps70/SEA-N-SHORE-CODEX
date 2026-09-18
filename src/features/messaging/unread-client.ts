export const MESSAGING_UNREAD_COUNT_EVENT = 'sea-n-shore:messaging-unread-count'

type MessagingUnreadCountDetail = {
  count: number
}

function normalizeUnreadCount(count: number) {
  if (!Number.isFinite(count)) return 0
  return Math.max(0, Math.floor(count))
}

export function publishMessagingUnreadCount(count: number) {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<MessagingUnreadCountDetail>(
    MESSAGING_UNREAD_COUNT_EVENT,
    { detail: { count: normalizeUnreadCount(count) } },
  ))
}

export function subscribeMessagingUnreadCount(listener: (count: number) => void) {
  if (typeof window === 'undefined') return () => {}

  const handle = (event: Event) => {
    const customEvent = event as CustomEvent<MessagingUnreadCountDetail>
    listener(normalizeUnreadCount(customEvent.detail?.count ?? 0))
  }

  window.addEventListener(MESSAGING_UNREAD_COUNT_EVENT, handle)
  return () => window.removeEventListener(MESSAGING_UNREAD_COUNT_EVENT, handle)
}

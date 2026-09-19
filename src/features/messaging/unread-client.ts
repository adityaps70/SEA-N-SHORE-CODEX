export const MESSAGING_UNREAD_COUNT_EVENT = 'sea-n-shore:messaging-unread-count'

type MessagingUnreadCountDetail = {
  count: number
  revision?: number
}

export type MessagingUnreadCountSnapshot = Readonly<{
  count: number
  revision: number
}>

let unreadSnapshot: MessagingUnreadCountSnapshot = {
  count: 0,
  revision: 0,
}

function normalizeUnreadCount(count: number) {
  if (!Number.isFinite(count)) return 0
  return Math.max(0, Math.floor(count))
}

function retainMessagingUnreadCount(count: number, revision?: number) {
  const normalized = normalizeUnreadCount(count)
  const nextRevision = typeof revision === 'number'
    && Number.isFinite(revision)
    && revision > unreadSnapshot.revision
    ? Math.floor(revision)
    : unreadSnapshot.revision + 1

  unreadSnapshot = {
    count: normalized,
    revision: nextRevision,
  }

  return unreadSnapshot
}

export function getMessagingUnreadCountSnapshot() {
  return unreadSnapshot
}

export function createMessagingUnreadCountView(initialCount: number) {
  const serverCount = normalizeUnreadCount(initialCount)
  const baselineRevision = unreadSnapshot.revision

  return () => (
    unreadSnapshot.revision > baselineRevision
      ? unreadSnapshot.count
      : serverCount
  )
}

export function publishMessagingUnreadCount(count: number) {
  if (typeof window === 'undefined') return

  const next = retainMessagingUnreadCount(count)
  window.dispatchEvent(new CustomEvent<MessagingUnreadCountDetail>(
    MESSAGING_UNREAD_COUNT_EVENT,
    { detail: { count: next.count, revision: next.revision } },
  ))
}

export function subscribeMessagingUnreadCount(listener: (count: number) => void) {
  if (typeof window === 'undefined') return () => {}

  const handle = (event: Event) => {
    const customEvent = event as CustomEvent<MessagingUnreadCountDetail>
    const count = normalizeUnreadCount(customEvent.detail?.count ?? 0)
    const revision = customEvent.detail?.revision

    if (
      typeof revision === 'number'
      && revision === unreadSnapshot.revision
      && count === unreadSnapshot.count
    ) {
      listener(count)
      return
    }

    const next = retainMessagingUnreadCount(count, revision)
    listener(next.count)
  }

  window.addEventListener(MESSAGING_UNREAD_COUNT_EVENT, handle)
  return () => window.removeEventListener(MESSAGING_UNREAD_COUNT_EVENT, handle)
}

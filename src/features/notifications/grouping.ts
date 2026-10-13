import type { NetworkNotification, NetworkNotificationType } from './types'

/**
 * Round G (G6): reactions and comments on the same post within 24 hours merge into one row,
 * "<newest name> and 5 others reacted to your post", with the newest actor's avatar; tapping it
 * opens the post. Mentions, tags, connection requests, job matches and event changes are never
 * merged and carry an "Important" marker until read. Behind ranking_settings.notifications.
 */
export const GROUP_WINDOW_MS = 24 * 60 * 60 * 1000

const GROUP_FAMILY: Partial<Record<NetworkNotificationType, { family: string; verb: string }>> = {
  post_reaction: { family: 'reaction', verb: 'reacted to your post' },
  post_comment: { family: 'comment', verb: 'commented on your post' },
}

export const IMPORTANT_TYPES: ReadonlySet<NetworkNotificationType> = new Set([
  'post_mention', 'comment_mention', 'photo_tag', 'organization_mention', 'connection_request', 'job_alert_match', 'event_cancelled',
])

/** Rows must be newest first (as the repository returns them). */
export function groupNotifications(rows: readonly NetworkNotification[]): NetworkNotification[] {
  const open = new Map<string, { head: NetworkNotification; members: NetworkNotification[] }>()
  const groups: Array<{ head: NetworkNotification; members: NetworkNotification[] }> = []
  const out: NetworkNotification[] = []
  for (const row of rows) {
    const family = GROUP_FAMILY[row.type]
    if (!family || !row.postId) {
      out.push(IMPORTANT_TYPES.has(row.type) ? { ...row, important: true } : row)
      continue
    }
    const key = `${family.family}:${row.postId}`
    const group = open.get(key)
    if (group && Date.parse(group.head.createdAt) - Date.parse(row.createdAt) <= GROUP_WINDOW_MS) {
      group.members.push(row)
      continue
    }
    const head = { ...row }
    const fresh = { head, members: [row] }
    open.set(key, fresh)
    groups.push(fresh)
    out.push(head)
  }
  for (const { head, members } of groups) {
    if (members.length < 2) continue
    const family = GROUP_FAMILY[members[0]!.type]!
    const others = new Set(members.slice(1).map((member) => member.actor?.id ?? member.id))
    others.delete(head.actor?.id ?? head.id)
    const name = head.actor?.fullName ?? 'A maritime professional'
    head.groupIds = members.map((member) => member.id)
    head.groupCount = members.length
    head.readAt = members.some((member) => !member.readAt) ? null : head.readAt
    head.message = others.size
      ? `${name} and ${others.size} other${others.size === 1 ? '' : 's'} ${family.verb}.`
      : `${name} ${family.verb} ${members.length} times.`
  }
  return out
}

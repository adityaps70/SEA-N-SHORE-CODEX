import { requireUser } from '@/features/auth/queries'
import { getPublicProfilesByIds } from '@/features/profiles/queries'
import { createServerSupabaseClient } from '@/lib/supabase/server'
import type { NetworkNotification, NetworkNotificationType, NotificationChrome } from './types'

type NotificationRow = {
  id: string
  actor_id: string | null
  notification_type: NetworkNotificationType
  created_at: string
  read_at: string | null
}

const copyByType: Record<NetworkNotificationType, string> = {
  connection_request: 'sent you a connection request',
  connection_accepted: 'accepted your connection request',
  new_follower: 'started following you',
}

async function loadNotificationData(limit: number) {
  const user = await requireUser()
  const supabase = await createServerSupabaseClient()
  const safeLimit = Math.min(Math.max(limit, 1), 50)

  const [rowsResult, unreadResult] = await Promise.all([
    supabase
      .from('notifications')
      .select('id,actor_id,notification_type,created_at,read_at')
      .eq('recipient_id', user.id)
      .order('created_at', { ascending: false })
      .limit(safeLimit),
    supabase
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('recipient_id', user.id)
      .is('read_at', null),
  ])

  if (rowsResult.error || unreadResult.error) {
    throw new Error('Unable to load notifications.')
  }

  const rows = (rowsResult.data ?? []) as NotificationRow[]
  const actorIds = [...new Set(rows.flatMap((row) => row.actor_id ? [row.actor_id] : []))]
  const profiles = actorIds.length ? await getPublicProfilesByIds(actorIds) : []
  const profilesById = new Map(profiles.map((profile) => [profile.id, profile]))

  const notifications: NetworkNotification[] = rows.map((row) => {
    const profile = row.actor_id ? profilesById.get(row.actor_id) : undefined
    const actor = profile ? { id: profile.id, slug: profile.slug, fullName: profile.fullName } : null
    const actorName = actor?.fullName ?? 'A maritime professional'
    const destination = row.notification_type === 'connection_request'
      ? '/network?tab=requests'
      : actor
        ? `/people/${actor.slug}`
        : '/network'

    return {
      id: row.id,
      type: row.notification_type,
      createdAt: row.created_at,
      readAt: row.read_at,
      actor,
      message: `${actorName} ${copyByType[row.notification_type]}.`,
      destination,
    }
  })

  return { notifications, unreadCount: unreadResult.count ?? 0 }
}

export async function getNotifications(limit = 50): Promise<NetworkNotification[]> {
  const { notifications } = await loadNotificationData(limit)
  return notifications
}

export async function getNotificationChrome(): Promise<NotificationChrome> {
  const { notifications, unreadCount } = await loadNotificationData(8)
  return { recent: notifications, unreadCount }
}

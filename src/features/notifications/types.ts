export type NetworkNotificationType = 'connection_request' | 'connection_accepted' | 'new_follower'

export type NotificationActor = {
  id: string
  slug: string
  fullName: string
}

export type NetworkNotification = {
  id: string
  type: NetworkNotificationType
  createdAt: string
  readAt: string | null
  actor: NotificationActor | null
  message: string
  destination: string
}

export type NotificationChrome = {
  recent: NetworkNotification[]
  unreadCount: number
}

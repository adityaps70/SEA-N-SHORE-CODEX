/**
 * Round H (H2): two privacy choices in Settings › Privacy, enforced on the server.
 * - Who can message me: everyone, connections (the default, the rule before round H) or nobody.
 * - Who can see my connections (the connections, followers and following lists): everyone, connections (the
 *   default, the rule before round H) or only me.
 */
export const MESSAGE_PERMISSIONS = ['everyone', 'connections', 'nobody'] as const
export type MessagePermission = (typeof MESSAGE_PERMISSIONS)[number]
export const DEFAULT_MESSAGE_PERMISSION: MessagePermission = 'connections'

export const CONNECTIONS_VISIBILITIES = ['everyone', 'connections', 'only_me'] as const
export type ConnectionsVisibility = (typeof CONNECTIONS_VISIBILITIES)[number]
export const DEFAULT_CONNECTIONS_VISIBILITY: ConnectionsVisibility = 'connections'

export const MESSAGE_PERMISSION_LABELS: Record<MessagePermission, string> = {
  everyone: 'Everyone on Sea N Shore',
  connections: 'My connections only',
  nobody: 'Nobody',
}

export const CONNECTIONS_VISIBILITY_LABELS: Record<ConnectionsVisibility, string> = {
  everyone: 'Everyone',
  connections: 'My connections',
  only_me: 'Only me',
}

export function messagePermissionFrom(value: unknown): MessagePermission {
  return (MESSAGE_PERMISSIONS as readonly unknown[]).includes(value) ? value as MessagePermission : DEFAULT_MESSAGE_PERMISSION
}

export function connectionsVisibilityFrom(value: unknown): ConnectionsVisibility {
  return (CONNECTIONS_VISIBILITIES as readonly unknown[]).includes(value) ? value as ConnectionsVisibility : DEFAULT_CONNECTIONS_VISIBILITY
}

/** May someone message this member? A block always wins. */
export function canMessageMember(input: { permission: MessagePermission; connected: boolean; blocked: boolean }) {
  if (input.blocked) return false
  if (input.permission === 'nobody') return false
  if (input.permission === 'connections') return input.connected
  return true
}

/** May this viewer see the member's connections list? The member always sees their own. */
export function canSeeConnections(input: { visibility: ConnectionsVisibility; isOwner: boolean; connected: boolean }) {
  if (input.isOwner) return true
  if (input.visibility === 'only_me') return false
  if (input.visibility === 'connections') return input.connected
  return true
}

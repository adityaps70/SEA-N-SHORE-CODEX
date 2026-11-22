import type { QueryResultRow } from 'pg'

/**
 * Round GP Part E: one way to write an admin decision to public.audit_events, so the log reads the same whoever
 * decided. Every row carries who decided (platform admin or country admin), the admin section and the country of the
 * item (null when it has none), next to the action's own details. Admin › Audit filters on these three keys.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

export type AdminActorRole = 'platform_admin' | 'country_admin'

export function actorRoleFor(scope: { kind: 'platform' | 'country' }): AdminActorRole {
  return scope.kind === 'country' ? 'country_admin' : 'platform_admin'
}

export async function recordAdminAudit(query: Query, entry: {
  actorId: string
  actorRole: AdminActorRole
  /** The admin section the decision belongs to (a country admin section, or e.g. "country_admins"). */
  section: string
  country: string | null
  action: string
  targetType: string
  targetId: string
  metadata?: Record<string, unknown>
}) {
  await query(
    `insert into public.audit_events (actor_id, action, target_type, target_id, metadata)
     values ($1, $2, $3, $4, $5::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.targetType,
      entry.targetId,
      JSON.stringify({ ...entry.metadata, actorRole: entry.actorRole, section: entry.section, country: entry.country }),
    ],
  )
}

import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import type { ModerationReportReason, ModerationTargetType } from './types'

type ModerationQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>
type OwnerRow = QueryResultRow & { owner_id: string | null }

function targetLookupSql(targetType: ModerationTargetType) {
  if (targetType === 'post') {
    return `select author_id as owner_id
      from public.posts
      where id = $1 and deleted_at is null
      limit 1`
  }
  if (targetType === 'comment') {
    return `select author_id as owner_id
      from public.post_comments
      where id = $1 and deleted_at is null
      limit 1`
  }
  if (targetType === 'job') {
    return `select created_by_user_id as owner_id
      from public.jobs
      where id = $1 and status = 'published'
      limit 1`
  }
  return `select host_user_id as owner_id
    from public.events
    where id = $1 and status = 'published'
    limit 1`
}

export function createModerationRepository(input: { query?: ModerationQuery } = {}) {
  const queryRows: ModerationQuery = input.query ?? ((text, values) => databaseQuery<QueryResultRow>(text, values))

  async function reportContent(input: {
    reporterId: string
    targetType: ModerationTargetType
    targetId: string
    reason: ModerationReportReason
    details: string | null
  }) {
    const rows = await queryRows(targetLookupSql(input.targetType), [input.targetId]) as OwnerRow[]
    const target = rows[0]
    if (!target) throw new Error('moderation_target_unavailable')
    if (target.owner_id === input.reporterId) throw new Error('moderation_self_report_forbidden')

    await queryRows(
      `insert into public.content_reports (
         target_type,
         target_id,
         reporter_id,
         reason,
         details,
         status,
         created_at,
         updated_at
       )
       values ($1, $2, $3, $4, $5, 'open', now(), now())
       on conflict (target_type, target_id, reporter_id)
       do update set
         reason = excluded.reason,
         details = excluded.details,
         status = 'open',
         reviewed_by = null,
         reviewed_at = null,
         reviewer_note = null,
         updated_at = now()`,
      [
        input.targetType,
        input.targetId,
        input.reporterId,
        input.reason,
        input.details,
      ],
    )
  }

  return { reportContent }
}

export type ModerationRepository = ReturnType<typeof createModerationRepository>
export const moderationRepository = createModerationRepository()

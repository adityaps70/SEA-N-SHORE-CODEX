import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'

/** A member the viewer blocked (Settings → Blocked members). */
export type BlockedMember = {
  id: string
  fullName: string
  slug: string | null
  headline: string | null
  avatarPath: string | null
  blockedAt: string
}

type BlockedMemberRow = QueryResultRow & {
  id: string
  full_name: string | null
  slug: string | null
  headline: string | null
  avatar_path: string | null
  account_status: string | null
  blocked_at: string | Date
}

type BlockedMembersQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

/**
 * Lists only the blocks the viewer made (never who blocked them). Accounts that were deleted
 * keep their row so the block can still be lifted, but show no profile details.
 */
export function createBlockedMembersRepository(input: { query?: BlockedMembersQuery } = {}) {
  const queryRows: BlockedMembersQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  async function listBlockedByViewer(viewerId: string, limit = 200): Promise<BlockedMember[]> {
    const rows = await queryRows(
      `select
         p.id,
         p.full_name,
         p.slug,
         p.headline,
         p.avatar_path,
         p.account_status::text as account_status,
         b.created_at as blocked_at
       from public.user_blocks b
       join public.profiles p on p.id = b.blocked_id
       where b.blocker_id = $1
       order by b.created_at desc, p.id asc
       limit $2`,
      [viewerId, Math.min(Math.max(Math.trunc(limit), 1), 500)],
    ) as BlockedMemberRow[]

    return rows.map((row) => {
      const active = row.account_status === 'active'
      return {
        id: row.id,
        fullName: row.full_name?.trim() || 'Sea N Shore member',
        slug: active ? row.slug : null,
        headline: active ? row.headline : null,
        avatarPath: active ? row.avatar_path : null,
        blockedAt: row.blocked_at instanceof Date ? row.blocked_at.toISOString() : row.blocked_at,
      }
    })
  }

  return { listBlockedByViewer }
}

export const blockedMembersRepository = createBlockedMembersRepository()

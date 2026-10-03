import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'

export type ProfileMediaKind = 'avatar' | 'cover'

type MediaPathRow = QueryResultRow & {
  id: string
  avatar_path: string | null
  cover_path: string | null
}

type PreviousPathRow = QueryResultRow & { previous_path: string | null }

type QueryClient = Pick<DatabaseQueryClient, 'query'>

export function createProfileMediaRepository(client?: QueryClient) {
  const query = client?.query.bind(client) ?? (async <T extends QueryResultRow>(text: string, values?: readonly unknown[]) => ({ rows: await databaseQuery<T>(text, values) }))

  async function getMediaPaths(profileIds: string[]) {
    if (profileIds.length === 0) return new Map<string, { avatarPath: string | null; coverPath: string | null }>()
    const result = await query<MediaPathRow>(
      `select id, avatar_path, cover_path
       from public.profiles
       where id = any($1::uuid[])`,
      [[...new Set(profileIds)]],
    )
    return new Map(result.rows.map((row) => [row.id, { avatarPath: row.avatar_path, coverPath: row.cover_path }]))
  }

  async function replaceMediaPath(profileId: string, kind: ProfileMediaKind, nextPath: string | null): Promise<string | null> {
    const column = kind === 'avatar' ? 'avatar_path' : 'cover_path'
    const result = await query<PreviousPathRow>(
      `with current as (
         select ${column} as previous_path
         from public.profiles
         where id = $1
         for update
       )
       update public.profiles p
       set ${column} = $2,
           updated_at = now()
       from current
       where p.id = $1
       returning current.previous_path`,
      [profileId, nextPath],
    )
    if (result.rows.length !== 1) throw new Error('profile_media_profile_missing')
    return result.rows[0]?.previous_path ?? null
  }

  return { getMediaPaths, replaceMediaPath }
}

export const profileMediaRepository = createProfileMediaRepository()

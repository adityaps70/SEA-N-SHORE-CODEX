import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import {
  PROFILE_NETWORK_LIST_LIMIT,
  type ProfileNetworkCounts,
  type ProfileNetworkList,
  type ProfileNetworkSummary,
} from './profile-network-links'

type StatsQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type CountRow = QueryResultRow & {
  connections: number | string | null
  followers: number | string | null
  following: number | string | null
}

type IdRow = QueryResultRow & { id: string }

const ACTIVE_MEMBER = `o.account_status = 'active' and o.onboarding_completed_at is not null`

export function createProfileNetworkStatsRepository(input: { query?: StatsQuery } = {}) {
  const queryRows: StatsQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  async function getCounts(profileId: string): Promise<ProfileNetworkCounts> {
    const rows = await queryRows(
      `select
         (
           select count(*)
           from public.connections c
           join public.profiles o
             on o.id = case when c.user_low_id = $1 then c.user_high_id else c.user_low_id end
           where (c.user_low_id = $1 or c.user_high_id = $1)
             and c.status = 'accepted'
             and ${ACTIVE_MEMBER}
         ) as connections,
         (
           select count(*)
           from public.follows f
           join public.profiles o on o.id = f.follower_id
           where f.following_id = $1
             and ${ACTIVE_MEMBER}
         ) as followers,
         (
           select count(*)
           from public.follows f
           join public.profiles o on o.id = f.following_id
           where f.follower_id = $1
             and ${ACTIVE_MEMBER}
         ) as following`,
      [profileId],
    ) as CountRow[]
    const row = rows[0]
    return {
      connections: Number(row?.connections ?? 0),
      followers: Number(row?.followers ?? 0),
      following: Number(row?.following ?? 0),
    }
  }

  async function areConnected(profileA: string, profileB: string) {
    if (profileA === profileB) return false
    const [low, high] = profileA < profileB ? [profileA, profileB] : [profileB, profileA]
    const rows = await queryRows(
      `select id
       from public.connections
       where user_low_id = $1
         and user_high_id = $2
         and status = 'accepted'
       limit 1`,
      [low, high],
    ) as IdRow[]
    return rows.length > 0
  }

  /** Newest first; profile visibility (active, onboarded, not blocked) is applied when profiles are loaded. */
  async function listIds(profileId: string, list: ProfileNetworkList, limit = PROFILE_NETWORK_LIST_LIMIT): Promise<string[]> {
    const statements: Record<ProfileNetworkList, string> = {
      connections: `select case when c.user_low_id = $1 then c.user_high_id else c.user_low_id end as id
                    from public.connections c
                    where (c.user_low_id = $1 or c.user_high_id = $1)
                      and c.status = 'accepted'
                    order by coalesce(c.responded_at, c.updated_at) desc, c.id asc
                    limit $2`,
      followers: `select f.follower_id as id
                  from public.follows f
                  where f.following_id = $1
                  order by f.created_at desc, f.follower_id asc
                  limit $2`,
      following: `select f.following_id as id
                  from public.follows f
                  where f.follower_id = $1
                  order by f.created_at desc, f.following_id asc
                  limit $2`,
    }
    const rows = await queryRows(statements[list], [profileId, limit]) as IdRow[]
    return rows.map((row) => row.id)
  }

  return { getCounts, areConnected, listIds }
}

export type ProfileNetworkStatsRepository = ReturnType<typeof createProfileNetworkStatsRepository>

export function createProfileNetworkStatsService(repository: Pick<ProfileNetworkStatsRepository, 'getCounts' | 'areConnected' | 'listIds'>) {
  async function canViewLists(viewerId: string, profileId: string) {
    return viewerId === profileId || await repository.areConnected(viewerId, profileId)
  }

  async function getSummary(viewerId: string | null, profileId: string): Promise<ProfileNetworkSummary | null> {
    if (!viewerId) return null
    const [counts, listsVisible] = await Promise.all([
      repository.getCounts(profileId),
      canViewLists(viewerId, profileId),
    ])
    return { counts, isOwner: viewerId === profileId, canViewLists: listsVisible }
  }

  async function getListIds(viewerId: string, profileId: string, list: ProfileNetworkList) {
    if (!await canViewLists(viewerId, profileId)) return null
    return repository.listIds(profileId, list)
  }

  return { canViewLists, getSummary, getListIds }
}

const productionService = createProfileNetworkStatsService(createProfileNetworkStatsRepository())

export const getProfileNetworkSummary = productionService.getSummary
export const getProfileNetworkListIds = productionService.getListIds

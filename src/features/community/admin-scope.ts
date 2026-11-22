import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { groupCountrySql } from '@/features/country-admins/item-country-sql'

/**
 * Round GP Part E: the reads Admin › Communities needs for country admins. A group's country is its owner
 * organization's country, or else its active owner member's country of residence (null = platform only).
 */
type Row = QueryResultRow & Record<string, unknown>

export const adminQuery = (text: string, values?: readonly unknown[]) => databaseQuery<Row>(text, values ? [...values] : undefined)

export function createCommunityAdminScope(query: (text: string, values?: readonly unknown[]) => Promise<Row[]> = adminQuery) {
  return async function communityGroupCountry(groupId: string): Promise<string | null> {
    const rows = await query(`select ${groupCountrySql('g')} as country from public.community_groups g where g.id = $1`, [groupId])
    const country = rows[0]?.country
    return typeof country === 'string' ? country : null
  }
}

export const communityGroupCountry = createCommunityAdminScope()

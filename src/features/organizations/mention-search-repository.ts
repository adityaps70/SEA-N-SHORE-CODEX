import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { organizationLogoUrl } from './organization-page-profile'
import { displayOrganizationType } from './organization-types'
import { organizationClaimStatusSql } from './unclaimed-organization-policy'

/**
 * Organizations a member can tag with "@" in a post or comment (round 9B).
 *
 * Only pages somebody stands behind are offered: verified organizations and claimed pages.
 * Unclaimed pages (added by someone who "just works there") and organizations whose
 * application was suspended by Sea N Shore are left out. Name matches anywhere, with names
 * that start with the typed text first.
 */

export type MentionableOrganization = {
  id: string
  slug: string
  name: string
  logoUrl: string | null
  /** Organization type and first office location, e.g. "Ship manager · Chennai". */
  subtitle: string | null
  verified: boolean
}

export const MENTIONABLE_ORGANIZATIONS_LIMIT = 5

type MentionSearchQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type MentionableOrganizationRow = QueryResultRow & {
  id: string
  slug: string
  name: string
  logo_path: string | null
  company_type: string | null
  organization_type: string | null
  office_locations: string[] | null
  is_verified: boolean | null
}

/** Escapes LIKE wildcards so "_" and "%" in the typed text match literally. */
export function likeLiteral(value: string) {
  return value.replace(/[\\%_]/g, '\\$&')
}

export function organizationMentionSubtitle(row: Pick<MentionableOrganizationRow, 'company_type' | 'organization_type' | 'office_locations'>) {
  const type = row.company_type || row.organization_type ? displayOrganizationType(row.organization_type, row.company_type) : null
  const location = (row.office_locations ?? []).map((item) => item?.trim()).find(Boolean) ?? null
  const parts = [type, location].filter((part): part is string => Boolean(part))
  return parts.length ? parts.join(' · ') : null
}

export function createOrganizationMentionSearchRepository(input: { query?: MentionSearchQuery } = {}) {
  const queryRows: MentionSearchQuery = input.query ?? ((text, values) => databaseQuery(text, values))

  async function searchMentionableOrganizations(term: string, limit = MENTIONABLE_ORGANIZATIONS_LIMIT): Promise<MentionableOrganization[]> {
    const normalized = term.trim().replace(/^@+/, '').slice(0, 80)
    if (!normalized) return []
    const literal = likeLiteral(normalized)
    const rows = await queryRows(
      `select c.id, c.slug, c.name, c.logo_path, c.company_type, c.organization_type, c.office_locations,
              coalesce(c.is_verified, false) as is_verified
       from public.companies c
       where c.name ilike $1 escape '\\'
         and (coalesce(c.is_verified, false) or ${organizationClaimStatusSql('c')} = 'claimed')
         and not exists (
           select 1 from public.organization_applications oa
           where oa.company_id = c.id and oa.status = 'suspended'
         )
       order by (c.name ilike $2 escape '\\') desc, coalesce(c.is_verified, false) desc, c.name asc, c.id asc
       limit $3`,
      [`%${literal}%`, `${literal}%`, Math.max(1, Math.min(limit, 20))],
    ) as MentionableOrganizationRow[]

    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      logoUrl: organizationLogoUrl({ id: row.id, logoPath: row.logo_path ?? null }),
      subtitle: organizationMentionSubtitle(row),
      verified: Boolean(row.is_verified),
    }))
  }

  return { searchMentionableOrganizations }
}

export const organizationMentionSearchRepository = createOrganizationMentionSearchRepository()

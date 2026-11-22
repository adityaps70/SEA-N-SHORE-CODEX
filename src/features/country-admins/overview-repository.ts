import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { createSharedCache } from '@/lib/server/shared-cache'
import { needsPlatformSql } from '@/features/organizations/access-request-repository'
import {
  companyCountrySql,
  courseCountrySql,
  eventCountrySql,
  memberCountrySql,
  reportTargetCountrySql,
} from './item-country-sql'
import { resolveSectionScope } from './scope'

/**
 * Round GP Part E: the admin Overview's counts.
 * - A country admin with the Overview sees counts for their own countries, in the sections they have.
 * - A platform administrator also sees what is waiting with no stored country (only they can decide those).
 * Counts only, never member rows. Cached for 30 seconds per set of countries (the same for every admin with it).
 */
type Row = QueryResultRow & Record<string, unknown>
type Query = (text: string, values?: readonly unknown[]) => Promise<Row[]>

export type AdminCountryCounts = {
  pendingOrganizations: number
  changesRequestedOrganizations: number
  coursesWaiting: number
  trainerApplicationsPending: number
  publishedEvents: number
  reportedEvents: number
  openReportCases: number
  verificationsPending: number
  accessRequestsWaiting: number
}

const number = (value: unknown) => (typeof value === 'number' ? value : Number(value ?? 0)) || 0

/** One count query; `match` is the SQL condition on each item's country expression ("in my countries" or "none"). */
export function countsSql(match: (countrySql: string) => string) {
  return `select
    (select count(*) from public.organization_applications oa
      where oa.status = 'pending' and ${match(companyCountrySql('oa.company_id'))}) as pending_organizations,
    (select count(*) from public.organization_applications oa
      where oa.status = 'changes_requested' and ${match(companyCountrySql('oa.company_id'))}) as changes_requested_organizations,
    (select count(*) from public.learning_courses lc
      where lc.status = 'submitted' and lc.revision_closed_at is null and ${match(courseCountrySql('lc'))}) as courses_waiting,
    (select count(*) from public.learning_mentor_applications ma
      where ma.status = 'pending' and ${match(memberCountrySql('ma.user_id'))}) as trainer_applications_pending,
    (select count(*) from public.events e
      where e.status = 'published' and ${match(eventCountrySql('e'))}) as published_events,
    (select count(distinct cr.target_id) from public.content_reports cr
      where cr.target_type = 'event' and cr.status in ('open', 'reviewing')
        and ${match(reportTargetCountrySql('cr.target_type', 'cr.target_id'))}) as reported_events,
    (select count(*) from (
      select distinct cr.target_type, cr.target_id from public.content_reports cr
      where cr.status in ('open', 'reviewing')
        and ${match(reportTargetCountrySql('cr.target_type', 'cr.target_id'))}
    ) cases) as open_report_cases,
    (select count(*) from public.feature_verifications fv
      where fv.status = 'pending' and fv.verification_type in ('recruiter', 'event_host')
        and ${match(memberCountrySql('fv.profile_id'))}) as verifications_pending,
    (select count(*) from public.company_access_requests car
      where ${needsPlatformSql('car')} and ${match(companyCountrySql('car.company_id'))}) as access_requests_waiting`
}

function mapCounts(row: Row | undefined): AdminCountryCounts {
  return {
    pendingOrganizations: number(row?.pending_organizations),
    changesRequestedOrganizations: number(row?.changes_requested_organizations),
    coursesWaiting: number(row?.courses_waiting),
    trainerApplicationsPending: number(row?.trainer_applications_pending),
    publishedEvents: number(row?.published_events),
    reportedEvents: number(row?.reported_events),
    openReportCases: number(row?.open_report_cases),
    verificationsPending: number(row?.verifications_pending),
    accessRequestsWaiting: number(row?.access_requests_waiting),
  }
}

export function createAdminOverviewRepository(input: { query?: Query; cacheTtlMs?: number } = {}) {
  const query: Query = input.query ?? ((text, values) => databaseQuery<Row>(text, values))
  const ttlMs = input.cacheTtlMs ?? 30_000
  const overviewCache = createSharedCache<AdminCountryCounts>({ name: 'admin_country_overview', ttlMs, maxEntries: 200 })

  /** Counts for a country admin's own countries (they must have the Overview section). */
  async function countsForCountryAdmin(adminId: string) {
    const scope = await resolveSectionScope(query, adminId, 'overview', 'view')
    if (scope.kind !== 'country') throw new Error('admin_forbidden')
    const countries = [...scope.countries].sort()
    const counts = await overviewCache.get(`countries:${countries.join(',')}`, async () => (
      mapCounts((await query(countsSql((countrySql) => `${countrySql} = any($1::text[])`), [countries]))[0])
    ))
    return { countries, counts }
  }

  /** Platform administrators: what is waiting with no stored country, so only they can decide it. */
  async function countsWithoutCountry(adminId: string) {
    const scope = await resolveSectionScope(query, adminId, 'overview', 'view')
    if (scope.kind !== 'platform') throw new Error('admin_forbidden')
    return overviewCache.get('no-country', async () => mapCounts((await query(countsSql((countrySql) => `${countrySql} is null`)))[0]))
  }

  return { countsForCountryAdmin, countsWithoutCountry }
}

export const adminOverviewRepository = createAdminOverviewRepository()

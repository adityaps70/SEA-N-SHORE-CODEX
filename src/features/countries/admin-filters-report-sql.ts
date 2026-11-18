import { LIVE_JOB_SQL } from '@/features/jobs/repository'
import { statsSql } from './admin-country-repository'
import { COUNTRY_DIAL_CODE_MAX_LENGTH } from './catalog'
import { REGISTERED_MEMBER_SQL, VERIFIED_MEMBER_SQL, memberCountryCtes, memberCountryValues } from './member-country-sql'

/**
 * Round GP: the read-only production counts behind the Step 0 findings and Members by country
 * (scripts/aws/admin-filters-report-remote.py runs them through the RDS Data API in a rolled-back READ ONLY
 * transaction). Built from the same SQL as Admin › Members by country, so the report checks the page's own numbers.
 *
 * Every statement returns one row with one text column: a JSON object of counts. No names, emails, phone numbers,
 * locations or ids leave the database: only counts, two-letter country codes, dialling codes and status labels.
 * scripts/aws/admin-filters-report.sql.json is the committed copy the runner reads; admin-filters-report-sql.test.ts
 * keeps it equal to this module (UPDATE_ADMIN_FILTERS_REPORT_SQL=1 rewrites it).
 */
export const ADMIN_FILTERS_REPORT_STATEMENT_NAMES = [
  'members',
  'members_by_country',
  'members_by_phone_code',
  'companies',
  'organization_applications',
  'jobs',
  'payments',
  'app_country_stats',
  'direct_country_counts',
] as const
export type AdminFiltersReportStatementName = (typeof ADMIN_FILTERS_REPORT_STATEMENT_NAMES)[number]

const literal = (json: string) => `'${json.replaceAll("'", "''")}'::jsonb`

/** The member-country CTEs with their two lists written in as literals (the Data API runs them without parameters). */
function inlineCountryCtes() {
  const [names, dials] = memberCountryValues()
  const ctes = memberCountryCtes({ namesParam: 1, dialsParam: 2 })
  const inlined = ctes.replace('$1::jsonb', literal(names)).replace('$2::jsonb', literal(dials))
  if (/\$[0-9]/.test(inlined)) throw new Error('admin_filters_report_unbound_parameter')
  return inlined
}

const REGISTERED = REGISTERED_MEMBER_SQL('p')

export function adminFiltersReportStatements(): Record<AdminFiltersReportStatementName, string> {
  const ctes = inlineCountryCtes()
  const [names, dials] = memberCountryValues()
  const stats = statsSql('residence', null).text
    .replace('$1::jsonb', literal(names))
    .replace('$2::jsonb', literal(dials))
  if (/\$[0-9]/.test(stats)) throw new Error('admin_filters_report_unbound_parameter')

  return {
    members: `select json_build_object(
        'registered', count(*),
        'verified', count(*) filter (where ${VERIFIED_MEMBER_SQL('p')}),
        'location_filled', count(*) filter (where p.location is not null and btrim(p.location) <> ''),
        'time_zone_set', count(*) filter (where p.time_zone is not null),
        'country_of_residence_set', count(*) filter (where p.country_of_residence is not null),
        'nationality_set', count(*) filter (where p.nationality is not null),
        'phone_any', count(*) filter (where exists (select 1 from public.identity_accounts ia where ia.profile_id = p.id and ia.phone_number is not null)),
        'phone_verified', count(*) filter (where exists (select 1 from public.identity_accounts ia where ia.profile_id = p.id and ia.phone_number_verified)),
        'signup_country_recorded', count(*) filter (where exists (select 1 from public.member_signup_countries sc where sc.profile_id = p.id)),
        'session_country_known', count(*) filter (where exists (select 1 from public.auth_sessions s where s.profile_id = p.id and s.approx_country is not null))
      )::text
      from public.profiles p
      where ${REGISTERED}`,

    members_by_country: `with ${ctes},
      m as (
        select coalesce(mc.code, '') as code, mc.source
        from public.profiles p join member_country mc on mc.profile_id = p.id
        where ${REGISTERED}
      ),
      g as (
        select code, count(*) as members,
               count(*) filter (where source = 'profile') as chosen,
               count(*) filter (where source = 'location') as from_location,
               count(*) filter (where source = 'phone') as from_phone,
               count(*) filter (where source = 'signup') as from_signup
        from m group by code
      )
      select json_build_object(
        'top15', coalesce((select json_agg(row_to_json(t)) from (select * from g where code <> '' order by members desc, code limit 15) t), '[]'::json),
        'countries', (select count(*) from g where code <> ''),
        'unset', coalesce((select members from g where code = ''), 0)
      )::text`,

    members_by_phone_code: `with ${ctes},
      d as (
        select dc.prefix, dc.code
        from public.profiles p
        join lateral (
          select d.prefix, d.code
          from public.identity_accounts ia
          cross join generate_series(1, ${COUNTRY_DIAL_CODE_MAX_LENGTH}) as l(n)
          join country_dials d on d.prefix = substr(ia.phone_number, 2, l.n)
          where ia.profile_id = p.id and ia.phone_number like '+%'
          order by ia.phone_number_verified desc, ia.id, l.n desc
          limit 1
        ) dc on true
        where ${REGISTERED}
      )
      select json_build_object(
        'top15', coalesce((select json_agg(row_to_json(t)) from (
          select '+' || prefix as dialling_code, code, count(*) as members from d group by prefix, code order by 3 desc, 1 limit 15) t), '[]'::json),
        'members_with_phone_code', (select count(*) from d)
      )::text`,

    companies: `select json_build_object(
        'total', count(*),
        'claimed', count(*) filter (where c.claim_status = 'claimed'),
        'unclaimed', count(*) filter (where c.claim_status = 'unclaimed'),
        'verified', count(*) filter (where coalesce(c.is_verified, false)),
        'office_locations_filled', count(*) filter (where cardinality(c.office_locations) > 0),
        'organization_details_filled', count(*) filter (where c.organization_details <> '{}'::jsonb),
        'country_set', count(*) filter (where c.country is not null),
        'by_country_top15', coalesce((select json_agg(row_to_json(t)) from (
          select country as code, count(*) as organizations from public.companies where country is not null
          group by country order by 2 desc, 1 limit 15) t), '[]'::json)
      )::text
      from public.companies c`,

    organization_applications: `select coalesce(json_object_agg(key, total), '{}'::json)::text
      from (select oa.status || '/' || oa.request_kind as key, count(*) as total
            from public.organization_applications oa group by 1) t`,

    jobs: `select json_build_object(
        'live', count(*),
        'live_organization', count(*) filter (where j.company_id is not null),
        'live_personal', count(*) filter (where j.company_id is null)
      )::text
      from public.jobs j
      where ${LIVE_JOB_SQL}`,

    payments: `select json_build_object(
        'subscription_payments', coalesce((select json_object_agg(currency, total) from (
          select currency, count(*) as total from public.subscription_payments group by 1) t), '{}'::json),
        'event_orders', coalesce((select json_object_agg(key, total) from (
          select currency || '/' || status as key, count(*) as total from public.event_payment_orders group by 1) t), '{}'::json),
        'course_orders', coalesce((select json_object_agg(key, total) from (
          select currency || '/' || status as key, count(*) as total from public.course_payment_orders group by 1) t), '{}'::json)
      )::text`,

    app_country_stats: `select coalesce(json_agg(row_to_json(s)), '[]'::json)::text from (${stats}) s`,

    direct_country_counts: `select json_build_object(
        'chosen_members', coalesce((select json_object_agg(code, total) from (
          select p.country_of_residence as code, count(*) as total from public.profiles p
          where ${REGISTERED} and p.country_of_residence is not null group by 1) t), '{}'::json),
        'organizations', coalesce((select json_object_agg(code, total) from (
          select c.country as code, count(*) as total from public.companies c where c.country is not null group by 1) t), '{}'::json)
      )::text`,
  }
}

import { query as databaseQuery } from '@/lib/db/client'

/**
 * Round G (G0.1): fills the new taxonomy code columns for rows written before migration 0083 (new
 * and edited rows get them from triggers). Runs in the outbox worker in small batches; each batch
 * only touches rows whose code is still null, so it is safe to run any number of times. A value the
 * taxonomy does not know stays null and is listed on Admin › Ranking › Unmapped values.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export const TAXONOMY_BACKFILL_BATCH = 500

type Step = { name: string; sql: string }

/** Each step updates at most one batch of rows that have text but no code yet, after the given id. */
const STEPS: readonly Step[] = [
  {
    name: 'experience_rank',
    sql: `update public.profile_experiences e
          set rank_code = public.taxonomy_code('rank', e.title)
          where e.id in (
            select id from public.profile_experiences
            where rank_code is null and title is not null and id > $1::uuid
            order by id limit $2
          )
          returning e.id, e.rank_code is not null as mapped`,
  },
  {
    name: 'experience_vessel',
    sql: `update public.profile_experiences e
          set vessel_type_code = public.taxonomy_code('vessel', e.vessel_type)
          where e.id in (
            select id from public.profile_experiences
            where vessel_type_code is null and vessel_type is not null and id > $1::uuid
            order by id limit $2
          )
          returning e.id, e.vessel_type_code is not null as mapped`,
  },
  {
    name: 'credential_certificate',
    sql: `update public.profile_credentials c
          set certificate_type_code = public.taxonomy_code('certificate', c.name)
          where c.id in (
            select id from public.profile_credentials
            where certificate_type_code is null and id > $1::uuid
            order by id limit $2
          )
          returning c.id, c.certificate_type_code is not null as mapped`,
  },
  {
    name: 'profile_vessels',
    sql: `update public.maritime_profiles m
          set vessel_type_codes = public.taxonomy_codes('vessel', m.vessel_types)
          where m.user_id in (
            select user_id from public.maritime_profiles
            where vessel_type_codes is null and user_id > $1::uuid
            order by user_id limit $2
          )
          returning m.user_id as id, cardinality(m.vessel_type_codes) > 0 as mapped`,
  },
  {
    name: 'job_vessels',
    sql: `update public.jobs j
          set vessel_type_codes = public.taxonomy_codes('vessel', j.vessel_types)
          where j.id in (
            select id from public.jobs
            where vessel_type_codes is null and id > $1::uuid
            order by id limit $2
          )
          returning j.id, cardinality(j.vessel_type_codes) > 0 as mapped`,
  },
]

const FIRST_ID = '00000000-0000-0000-0000-000000000000'

export type TaxonomyBackfillResult = Record<string, { scanned: number; mapped: number }>

export async function runTaxonomyBackfill(input: { query?: Query; batch?: number; maxBatches?: number } = {}): Promise<TaxonomyBackfillResult> {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  const batch = input.batch ?? TAXONOMY_BACKFILL_BATCH
  const maxBatches = input.maxBatches ?? 200
  const result: TaxonomyBackfillResult = {}

  for (const step of STEPS) {
    let after = FIRST_ID
    let scanned = 0
    let mapped = 0
    for (let round = 0; round < maxBatches; round += 1) {
      const rows = await queryRows(step.sql, [after, batch])
      if (!rows.length) break
      scanned += rows.length
      mapped += rows.filter((row) => row.mapped === true).length
      after = rows.map((row) => String(row.id)).sort().at(-1) ?? after
      if (rows.length < batch) break
    }
    result[step.name] = { scanned, mapped }
  }

  // Job certificate requirements have a composite key; one statement covers them (few rows).
  const certificates = await queryRows(
    `update public.job_certificate_requirements r
     set certificate_type_code = public.taxonomy_code('certificate', r.certificate_name)
     where r.certificate_type_code is null
     returning r.certificate_type_code is not null as mapped`,
  )
  result.job_certificate = { scanned: certificates.length, mapped: certificates.filter((row) => row.mapped === true).length }
  return result
}

export type UnmappedValue = { kind: 'rank' | 'vessel' | 'certificate'; value: string; count: number }

/**
 * Free-text values with no taxonomy code, most common first (for Admin › Ranking). Values only,
 * never who typed them. Experience titles count only on sea service, where a title is a rank.
 */
export async function listUnmappedTaxonomyValues(input: { query?: Query; limit?: number } = {}): Promise<{ values: UnmappedValue[]; totals: Record<UnmappedValue['kind'], { distinct: number; rows: number }> }> {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))
  const limit = input.limit ?? 50
  const rows = await queryRows(
    `with raw as (
       select 'rank' as kind, btrim(mp.rank) as value from public.maritime_profiles mp
       join public.profiles p on p.id = mp.user_id
       where nullif(btrim(mp.rank), '') is not null and p.role_key is null and public.taxonomy_code('rank', mp.rank) is null
       union all
       select 'rank', btrim(e.title) from public.profile_experiences e
       where e.track = 'sea_service' and e.rank_code is null and nullif(btrim(e.title), '') is not null
       union all
       select 'vessel', btrim(e.vessel_type) from public.profile_experiences e
       where e.vessel_type_code is null and nullif(btrim(e.vessel_type), '') is not null
       union all
       select 'vessel', btrim(v) from public.maritime_profiles mp, unnest(mp.vessel_types) v
       where nullif(btrim(v), '') is not null and public.taxonomy_code('vessel', v) is null
       union all
       select 'vessel', btrim(v) from public.jobs j, unnest(j.vessel_types) v
       where nullif(btrim(v), '') is not null and public.taxonomy_code('vessel', v) is null
       union all
       select 'certificate', btrim(c.name) from public.profile_credentials c
       where c.certificate_type_code is null and nullif(btrim(c.name), '') is not null
       union all
       select 'certificate', btrim(r.certificate_name) from public.job_certificate_requirements r
       where r.certificate_type_code is null
     ),
     grouped as (
       select kind, lower(value) as value, count(*)::int as count from raw group by kind, lower(value)
     )
     select kind, value, count,
            count(*) over (partition by kind)::int as distinct_total,
            sum(count) over (partition by kind)::int as row_total,
            row_number() over (partition by kind order by count desc, value) as position
     from grouped`,
  )
  const totals = {
    rank: { distinct: 0, rows: 0 },
    vessel: { distinct: 0, rows: 0 },
    certificate: { distinct: 0, rows: 0 },
  }
  const values: UnmappedValue[] = []
  for (const row of rows) {
    const kind = row.kind as UnmappedValue['kind']
    totals[kind] = { distinct: Number(row.distinct_total), rows: Number(row.row_total) }
    if (Number(row.position) <= limit) values.push({ kind, value: String(row.value), count: Number(row.count) })
  }
  return { values, totals }
}

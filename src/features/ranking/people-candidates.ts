import { query as databaseQuery } from '@/lib/db/client'
import { SYNTHETIC_PROFILE_PATTERN_SQL, syntheticTextSql } from '@/features/profiles/repository'
import { PEOPLE_WEIGHTS } from './people-weights'

/**
 * Round G (G2): People you may know. Candidates come from the whole active member base through
 * several sources (mutual connections, shipmates, companies, institute, shared communities and
 * organizations, events, courses, profile match). Every exclusion runs in SQL before ranking:
 * the viewer, connections, pending requests either way, requests declined in the last 180 days,
 * follows, blocks either way, dismissals (180 days), inactive, unfinished, synthetic and
 * organisation profiles, and members who turned off "Show me in People you may know".
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export type PeopleCandidateFeatures = {
  candidateId: string
  mutualCount: number
  shipmateVessel: string | null
  shipmate: boolean
  sameCurrentCompany: string | null
  pastCompany: string | null
  pastCompanyOverlapYears: number
  sameInstitution: string | null
  sharedCommunities: number
  sharedCommunityName: string | null
  sharedOrganizations: number
  sharedEvents: number
  sharedCourses: number
  roleKey: string | null
  departmentKey: string | null
  persona: string | null
  vesselCodes: string[]
  tradingAreas: string[]
  location: string | null
  companyId: string | null
  companyName: string | null
  hasPhoto: boolean
  hasHeadline: boolean
  joinedDaysAgo: number
  lastActiveDaysAgo: number
  openToRecruiters: boolean
}

export type PeopleViewer = {
  id: string
  roleKey: string | null
  departmentKey: string | null
  persona: string | null
  vesselCodes: string[]
  tradingAreas: string[]
  location: string | null
  institution: string | null
  companyId: string | null
}

/** The CTE every People query shares: who may never be suggested to $1. */
export function excludedPeopleCte() {
  return `
  excluded as (
    select $1::uuid as id
    union select case when c.user_low_id = $1 then c.user_high_id else c.user_low_id end
      from public.connections c where c.user_low_id = $1 or c.user_high_id = $1
    union select following_id from public.follows where follower_id = $1
    union select blocked_id from public.user_blocks where blocker_id = $1
    union select blocker_id from public.user_blocks where blocked_id = $1
    union select target_profile_id from public.social_action_events
      where profile_id = $1 and action = 'connection_request' and target_profile_id is not null
        and created_at > now() - make_interval(days => ${PEOPLE_WEIGHTS.declinedRequestDays})
    union select target_id from public.suggestion_dismissals
      where viewer_id = $1 and kind = 'person' and created_at > now() - make_interval(days => ${PEOPLE_WEIGHTS.dismissDays})
  )`
}

/** Eligible candidate profile `alias` (with its maritime profile `maritimeAlias`). */
export function eligiblePersonSql(alias: string, maritimeAlias: string) {
  return `
    ${alias}.account_status = 'active'
    and ${alias}.onboarding_completed_at is not null
    and ${alias}.slug is not null
    and coalesce(${alias}.identity_root, 'professional') <> 'organisation'
    and ${alias}.profile_type is distinct from 'company'
    and ${alias}.id not in (select id from excluded where id is not null)
    and not exists (
      select 1 from public.member_preferences opt_out
      where opt_out.profile_id = ${alias}.id and opt_out.show_in_people_suggestions = false
    )
    and not ${syntheticTextSql(`concat_ws(' ', ${alias}.slug, ${alias}.full_name, ${alias}.headline, ${alias}.summary, ${maritimeAlias}.rank, ${maritimeAlias}.current_company)`, `'${SYNTHETIC_PROFILE_PATTERN_SQL.replace(/'/g, "''")}'`)}`
}

const CANDIDATE_SQL = `
  with viewer as (
    select p.id, p.role_key, p.role_department_key, p.persona, p.institution_name, p.location,
           mp.current_company_id, mp.current_company, coalesce(mp.vessel_type_codes, '{}') as vessel_codes
    from public.profiles p
    left join public.maritime_profiles mp on mp.user_id = p.id
    where p.id = $1
  ),
  viewer_connections as (
    select case when c.user_low_id = $1 then c.user_high_id else c.user_low_id end as id
    from public.connections c
    where (c.user_low_id = $1 or c.user_high_id = $1) and c.status = 'accepted'
  ),
  ${excludedPeopleCte()},
  mutual as (
    select case when c.user_low_id = vc.id then c.user_high_id else c.user_low_id end as candidate_id, count(*)::int as mutual_count
    from viewer_connections vc
    join public.connections c on (c.user_low_id = vc.id or c.user_high_id = vc.id) and c.status = 'accepted'
    group by 1
  ),
  shipmates as (
    select other.profile_id as candidate_id, min(other.vessel) as vessel
    from public.profile_experiences mine
    join public.profile_experiences other
      on public.taxonomy_normalize(other.vessel) = public.taxonomy_normalize(mine.vessel)
     and other.track = 'sea_service' and other.vessel is not null and other.profile_id <> mine.profile_id
     -- Overlapping dates: both started before the other ended (no end date = still on board).
     and other.started_on is not null and mine.started_on is not null
     and other.started_on <= coalesce(mine.ended_on, current_date)
     and mine.started_on <= coalesce(other.ended_on, current_date)
    where mine.profile_id = $1 and mine.track = 'sea_service' and mine.vessel is not null
    group by other.profile_id
  ),
  current_company as (
    select mp.user_id as candidate_id, coalesce(company.name, mp.current_company) as name
    from public.maritime_profiles mp
    cross join viewer v
    left join public.companies company on company.id = mp.current_company_id
    where mp.user_id <> $1 and (
      (v.current_company_id is not null and mp.current_company_id = v.current_company_id)
      or (v.current_company_id is null and v.current_company is not null and mp.current_company_id is null
          and public.taxonomy_normalize(mp.current_company) = public.taxonomy_normalize(v.current_company))
    )
  ),
  past_company as (
    select other.profile_id as candidate_id, min(other.organization) as name,
           max(greatest(0, least(coalesce(mine.ended_on, current_date), coalesce(other.ended_on, current_date))
             - greatest(coalesce(mine.started_on, current_date), coalesce(other.started_on, current_date))) / 365.0) as overlap_years
    from public.profile_experiences mine
    join public.profile_experiences other
      on public.taxonomy_normalize(other.organization) = public.taxonomy_normalize(mine.organization)
     and other.organization is not null and other.profile_id <> mine.profile_id
    where mine.profile_id = $1 and mine.organization is not null
    group by other.profile_id
  ),
  institution as (
    select p.id as candidate_id, p.institution_name as name
    from public.profiles p cross join viewer v
    where v.institution_name is not null and p.institution_name is not null and p.id <> $1
      and public.taxonomy_normalize(p.institution_name) = public.taxonomy_normalize(v.institution_name)
  ),
  communities as (
    select other.profile_id as candidate_id, count(*)::int as shared, min(g.name) as name
    from public.community_group_memberships mine
    join public.community_group_memberships other on other.group_id = mine.group_id and other.status = 'active' and other.profile_id <> $1
    join public.community_groups g on g.id = mine.group_id and g.archived_at is null
    where mine.profile_id = $1 and mine.status = 'active'
    group by other.profile_id
  ),
  organizations as (
    select other.user_id as candidate_id, count(*)::int as shared
    from public.company_members mine
    join public.company_members other on other.company_id = mine.company_id and other.user_id <> $1
    where mine.user_id = $1
    group by other.user_id
  ),
  events as (
    select other.user_id as candidate_id, count(*)::int as shared
    from public.event_attendees mine
    join public.event_attendees other on other.event_id = mine.event_id and other.user_id <> $1
    where mine.user_id = $1
    group by other.user_id
  ),
  courses as (
    select other.learner_id as candidate_id, count(*)::int as shared
    from public.learning_enrollments mine
    join public.learning_enrollments other on other.course_id = mine.course_id and other.learner_id <> $1
    where mine.learner_id = $1
    group by other.learner_id
  ),
  profile_match as (
    select p.id as candidate_id
    from public.profiles p
    left join public.maritime_profiles mp on mp.user_id = p.id
    cross join viewer v
    where p.id <> $1 and p.account_status = 'active' and p.onboarding_completed_at is not null
      and (
        (v.role_department_key is not null and p.role_department_key = v.role_department_key)
        or (cardinality(v.vessel_codes) > 0 and mp.vessel_type_codes && v.vessel_codes)
        or (v.location is not null and lower(btrim(p.location)) = lower(btrim(v.location)))
        or (v.persona = 'student_cadet' and p.persona in ('trainer_instructor', 'recruiter_hr'))
      )
    order by p.updated_at desc
    limit $2
  ),
  pool as (
    select candidate_id from (select candidate_id from mutual order by mutual_count desc limit $2) m
    union select candidate_id from shipmates
    union select candidate_id from (select candidate_id from current_company limit $2) cc
    union select candidate_id from (select candidate_id from past_company limit $2) pc
    union select candidate_id from (select candidate_id from institution limit $2) i
    union select candidate_id from (select candidate_id from communities order by shared desc limit $2) cm
    union select candidate_id from organizations
    union select candidate_id from (select candidate_id from events order by shared desc limit $2) e
    union select candidate_id from (select candidate_id from courses order by shared desc limit $2) co
    union select candidate_id from profile_match
  )
  select
    c.id as candidate_id,
    coalesce(m.mutual_count, 0) as mutual_count,
    s.candidate_id is not null as shipmate,
    s.vessel as shipmate_vessel,
    cc.name as same_current_company,
    pc.name as past_company,
    coalesce(pc.overlap_years, 0) as past_company_overlap_years,
    i.name as same_institution,
    coalesce(cm.shared, 0) as shared_communities,
    cm.name as shared_community_name,
    coalesce(o.shared, 0) as shared_organizations,
    coalesce(e.shared, 0) as shared_events,
    coalesce(co.shared, 0) as shared_courses,
    c.role_key, c.role_department_key, c.persona, c.location,
    coalesce(cmp.vessel_type_codes, '{}') as vessel_codes,
    coalesce(cmp.trading_areas, '{}') as trading_areas,
    cmp.current_company_id as company_id,
    coalesce(company.name, cmp.current_company) as company_name,
    (c.avatar_path is not null and btrim(c.avatar_path) <> '') as has_photo,
    (c.headline is not null and btrim(c.headline) <> '') as has_headline,
    greatest(0, extract(epoch from (now() - c.created_at)) / 86400)::int as joined_days_ago,
    greatest(0, extract(epoch from (now() - greatest(
      c.updated_at,
      coalesce((select max(i2.last_seen_at) from public.post_impressions i2 where i2.viewer_id = c.id), c.updated_at),
      coalesce((select max(lp.created_at) from public.posts lp where lp.author_id = c.id and lp.deleted_at is null), c.updated_at)
    ))) / 86400)::int as last_active_days_ago,
    coalesce(pref.open_to_recruiters, false) as open_to_recruiters
  from pool
  join public.profiles c on c.id = pool.candidate_id
  left join public.maritime_profiles cmp on cmp.user_id = c.id
  left join public.companies company on company.id = cmp.current_company_id
  left join public.member_preferences pref on pref.profile_id = c.id
  left join mutual m on m.candidate_id = c.id
  left join shipmates s on s.candidate_id = c.id
  left join current_company cc on cc.candidate_id = c.id
  left join past_company pc on pc.candidate_id = c.id
  left join institution i on i.candidate_id = c.id
  left join communities cm on cm.candidate_id = c.id
  left join organizations o on o.candidate_id = c.id
  left join events e on e.candidate_id = c.id
  left join courses co on co.candidate_id = c.id
  where ${eligiblePersonSql('c', 'cmp')}
`

function textArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : []
}

export function mapPeopleCandidate(row: Record<string, unknown>): PeopleCandidateFeatures {
  return {
    candidateId: String(row.candidate_id),
    mutualCount: Number(row.mutual_count ?? 0),
    shipmate: row.shipmate === true,
    shipmateVessel: row.shipmate_vessel ? String(row.shipmate_vessel) : null,
    sameCurrentCompany: row.same_current_company ? String(row.same_current_company) : null,
    pastCompany: row.past_company ? String(row.past_company) : null,
    pastCompanyOverlapYears: Number(row.past_company_overlap_years ?? 0),
    sameInstitution: row.same_institution ? String(row.same_institution) : null,
    sharedCommunities: Number(row.shared_communities ?? 0),
    sharedCommunityName: row.shared_community_name ? String(row.shared_community_name) : null,
    sharedOrganizations: Number(row.shared_organizations ?? 0),
    sharedEvents: Number(row.shared_events ?? 0),
    sharedCourses: Number(row.shared_courses ?? 0),
    roleKey: row.role_key ? String(row.role_key) : null,
    departmentKey: row.role_department_key ? String(row.role_department_key) : null,
    persona: row.persona ? String(row.persona) : null,
    vesselCodes: textArray(row.vessel_codes),
    tradingAreas: textArray(row.trading_areas),
    location: row.location ? String(row.location) : null,
    companyId: row.company_id ? String(row.company_id) : null,
    companyName: row.company_name ? String(row.company_name) : null,
    hasPhoto: row.has_photo === true,
    hasHeadline: row.has_headline === true,
    joinedDaysAgo: Number(row.joined_days_ago ?? 0),
    lastActiveDaysAgo: Number(row.last_active_days_ago ?? 0),
    openToRecruiters: row.open_to_recruiters === true,
  }
}

export type StoredSuggestion = { candidateId: string; score: number; primarySource: string; reasons: unknown[] }

export function createPeopleCandidateRepository(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))

  async function getViewer(viewerId: string): Promise<PeopleViewer | null> {
    const rows = await queryRows(
      `select p.id, p.role_key, p.role_department_key, p.persona, p.location, p.institution_name,
              coalesce(mp.vessel_type_codes, '{}') as vessel_codes, coalesce(mp.trading_areas, '{}') as trading_areas,
              mp.current_company_id
       from public.profiles p left join public.maritime_profiles mp on mp.user_id = p.id
       where p.id = $1`,
      [viewerId],
    )
    const row = rows[0]
    if (!row) return null
    return {
      id: String(row.id),
      roleKey: row.role_key ? String(row.role_key) : null,
      departmentKey: row.role_department_key ? String(row.role_department_key) : null,
      persona: row.persona ? String(row.persona) : null,
      vesselCodes: textArray(row.vessel_codes),
      tradingAreas: textArray(row.trading_areas),
      location: row.location ? String(row.location) : null,
      institution: row.institution_name ? String(row.institution_name) : null,
      companyId: row.current_company_id ? String(row.current_company_id) : null,
    }
  }

  async function listCandidates(viewerId: string, perSourceLimit = 200): Promise<PeopleCandidateFeatures[]> {
    const rows = await queryRows(CANDIDATE_SQL, [viewerId, perSourceLimit])
    return rows.map(mapPeopleCandidate)
  }

  /** Replaces the viewer's precomputed rows in one statement pair (the read path re-checks exclusions live). */
  async function replaceSuggestions(viewerId: string, suggestions: readonly StoredSuggestion[]) {
    await queryRows(`delete from public.people_suggestions where viewer_id = $1`, [viewerId])
    if (!suggestions.length) return
    await queryRows(
      `insert into public.people_suggestions (viewer_id, candidate_id, score, primary_source, reasons)
       select $1, item.candidate_id, item.score, item.primary_source, item.reasons
       from jsonb_to_recordset($2::jsonb) as item(candidate_id uuid, score real, primary_source text, reasons jsonb)
       on conflict (viewer_id, candidate_id) do update set score = excluded.score, primary_source = excluded.primary_source,
         reasons = excluded.reasons, computed_at = now()`,
      [viewerId, JSON.stringify(suggestions.map((item) => ({ candidate_id: item.candidateId, score: item.score, primary_source: item.primarySource, reasons: item.reasons })))],
    )
  }

  /**
   * The precomputed rows, with every exclusion re-checked now: someone connected, requested,
   * followed, blocked or dismissed since the nightly run never shows. `section` filters by source.
   */
  async function listStored(viewerId: string, options: { limit: number; section?: string | null }) {
    const values: unknown[] = [viewerId, options.limit]
    let sectionSql = ''
    if (options.section) {
      values.push(options.section)
      sectionSql = `and ps.primary_source = $3`
    }
    const rows = await queryRows(
      `with ${excludedPeopleCte()}
       select ps.candidate_id, ps.score, ps.primary_source, ps.reasons, cmp.current_company_id as company_id,
              coalesce(company.name, cmp.current_company) as company_name
       from public.people_suggestions ps
       join public.profiles c on c.id = ps.candidate_id
       left join public.maritime_profiles cmp on cmp.user_id = c.id
       left join public.companies company on company.id = cmp.current_company_id
       where ps.viewer_id = $1 ${sectionSql} and ${eligiblePersonSql('c', 'cmp')}
       order by ps.score desc, ps.candidate_id
       limit $2`,
      values,
    )
    return rows.map((row) => ({
      candidateId: String(row.candidate_id),
      score: Number(row.score),
      primarySource: String(row.primary_source),
      reasons: Array.isArray(row.reasons) ? row.reasons : [],
      companyId: row.company_id ? String(row.company_id) : null,
      companyName: row.company_name ? String(row.company_name) : null,
    }))
  }

  /** Connecting, requesting, following, blocking or dismissing removes the row at once (both ways for blocks). */
  async function removePair(viewerId: string, candidateId: string, bothWays = false) {
    await queryRows(
      bothWays
        ? `delete from public.people_suggestions where (viewer_id = $1 and candidate_id = $2) or (viewer_id = $2 and candidate_id = $1)`
        : `delete from public.people_suggestions where viewer_id = $1 and candidate_id = $2`,
      [viewerId, candidateId],
    )
  }

  /** Members the nightly run covers: active and onboarded, oldest computation first. */
  async function listViewersToRefresh(afterId: string | null, limit: number) {
    const rows = await queryRows(
      `select p.id from public.profiles p
       where p.account_status = 'active' and p.onboarding_completed_at is not null
         and coalesce(p.identity_root, 'professional') <> 'organisation'
         and ($1::uuid is null or p.id > $1::uuid)
       order by p.id
       limit $2`,
      [afterId, limit],
    )
    return rows.map((row) => String(row.id))
  }

  /**
   * "People similar to <name>" on a member's profile: same rank band, vessel group or company as
   * that member, with the viewer's exclusions (never the viewer, their connections, requests,
   * follows, blocks or dismissals) and never the member themself.
   */
  async function listSimilarTo(viewerId: string, profileId: string, limit: number) {
    const rows = await queryRows(
      `with ${excludedPeopleCte()},
       subject as (
         select p.id, p.role_key, coalesce(mp.vessel_type_codes, '{}') as vessel_codes, mp.current_company_id,
                (select coalesce(array_agg(r.code), '{}'::text[]) from public.maritime_ranks sr
                 join public.maritime_ranks r on r.ladder = sr.ladder and r.department_key = sr.department_key and abs(r.ladder_level - sr.ladder_level) <= 1
                 where sr.code = p.role_key) as rank_band,
                (select coalesce(array_agg(distinct vt.vessel_group), '{}'::text[]) from public.vessel_types vt where vt.code = any(coalesce(mp.vessel_type_codes, '{}'))) as vessel_groups
         from public.profiles p left join public.maritime_profiles mp on mp.user_id = p.id
         where p.id = $2
       )
       select c.id,
              ((case when c.role_key = any(subject.rank_band) then 3 else 0 end)
               + (case when exists (select 1 from public.vessel_types vt where vt.code = any(coalesce(cmp.vessel_type_codes, '{}')) and vt.vessel_group = any(subject.vessel_groups)) then 2 else 0 end)
               + (case when subject.current_company_id is not null and cmp.current_company_id = subject.current_company_id then 3 else 0 end)) as score
       from public.profiles c
       left join public.maritime_profiles cmp on cmp.user_id = c.id
       cross join subject
       where c.id <> $2 and ${eligiblePersonSql('c', 'cmp')}
         and (
           c.role_key = any(subject.rank_band)
           or (subject.current_company_id is not null and cmp.current_company_id = subject.current_company_id)
           or exists (select 1 from public.vessel_types vt where vt.code = any(coalesce(cmp.vessel_type_codes, '{}')) and vt.vessel_group = any(subject.vessel_groups))
         )
       order by score desc, c.updated_at desc, c.id
       limit $3`,
      [viewerId, profileId, limit],
    )
    return rows.map((row) => String(row.id))
  }

  return { getViewer, listCandidates, replaceSuggestions, listStored, removePair, listViewersToRefresh, listSimilarTo }
}

export const peopleCandidateRepository = createPeopleCandidateRepository()

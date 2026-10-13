import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { mapPublicProfile } from './mappers'
import { organizationClaimStatusSql } from '@/features/organizations/unclaimed-organization-policy'
import { listableOrganizationSql } from './organization-link-repository'
import { PERSONAS, PROFILE_INTENTS, type Persona, type ProfileIntent } from './persona'
import {
  PROFILE_TYPES,
  type ContactVisibility,
  type IdentityRoot,
  type OwnProfile,
  type OwnProfileRow,
  type ProfileType,
  type PublicProfile,
  type PublicProfileRow,
} from './types'

type ProfileRow = QueryResultRow & {
  id: string
  slug: string | null
  profile_type: string | null
  identity_root?: string | null
  primary_identity?: string | null
  primary_identity_family?: string | null
  secondary_identities?: string[] | null
  persona?: string | null
  profile_intents?: string[] | null
  community_relationship?: string | null
  institution_name?: string | null
  specialization?: string | null
  role_department_key?: string | null
  role_key?: string | null
  role_other_text?: string | null
  cadet_stage_key?: string | null
  cadet_course_key?: string | null
  target_department_key?: string | null
  target_role_key?: string | null
  occupation_text?: string | null
  full_name: string
  avatar_path: string | null
  cover_path?: string | null
  location: string | null
  headline: string | null
  summary: string | null
  contact_visibility?: string | null
  onboarding_completed_at?: string | null
  username_change_count?: number | null
  username_auto_generated?: boolean | null
  maritime_profiles: PublicProfileRow['maritime_profiles']
  current_organization?: unknown
  profile_skills: Array<{ skill: string }> | null
}

type ProfileQuery = (
  text: string,
  values?: readonly unknown[],
) => Promise<ProfileRow[]>

export type PublicProfileLookup = {
  viewerProfileId?: string
}

export type PublicProfileBySlugLookup = PublicProfileLookup & {
  slug: string
}

export type PublicProfileByIdLookup = PublicProfileLookup & {
  profileId: string
}

export type PublicProfilesByIdsLookup = PublicProfileLookup & {
  ids: string[]
}

export type DiscoveryCandidateLookup = {
  viewerProfileId: string
  limit: number
  searchQuery?: string
}

export type PeopleSuggestionLookup = {
  viewerProfileId: string
  limit: number
  /** Points per shared attribute; see RECOMMENDATION_WEIGHTS in features/network/recommendations.ts. */
  weights: {
    sharedVesselType: number
    sharedSkill: number
    sharedTradingArea: number
    rankMatch: number
    sameProfileType: number
    sameLocation: number
  }
  /** A request the viewer sent that is gone (declined or withdrawn) hides that member this long. */
  declinedRequestWindow: string
  /**
   * Round G (migration 0083): also leave out members the viewer dismissed in the last 180 days and
   * members who turned off "Show me in People you may know".
   */
  roundG?: boolean
}

const ROUND_G_PEOPLE_EXCLUSIONS_SQL = `
      and not exists (
        select 1 from public.suggestion_dismissals d
        where d.viewer_id = viewer.id and d.kind = 'person' and d.target_id = cp.id and d.created_at > now() - interval '180 days'
      )
      and not exists (
        select 1 from public.member_preferences opt_out
        where opt_out.profile_id = cp.id and opt_out.show_in_people_suggestions = false
      )`

/**
 * The same narrow synthetic and test-data markers as isSyntheticDiscoveryText (lib/public-discovery.ts),
 * as one Postgres regular expression (\y is a word boundary), so they are excluded before the limit.
 */
/**
 * SQL that is true when `textSql` carries a synthetic marker. The regular expression only runs when
 * a cheap substring check finds a candidate word (CASE keeps that order), so a large member table
 * is not regex-scanned row by row.
 */
export function syntheticTextSql(textSql: string, patternSql: string) {
  return `(case when strpos(lower(${textSql}), 'e2e') > 0 or strpos(lower(${textSql}), 'synthetic') > 0
      or strpos(lower(${textSql}), 'fixture') > 0 or strpos(lower(${textSql}), 'seed') > 0
      or strpos(lower(${textSql}), 'test') > 0 or strpos(lower(${textSql}), '@example.') > 0
    then (${textSql}) ~* ${patternSql} else false end)`
}

export const SYNTHETIC_PROFILE_PATTERN_SQL = String.raw`\ye2e([-_[:space:]]|$)|\ysynthetic([-_[:space:]]|$)|\yfixture([-_[:space:]]|$)|\yseed(ed)?([-_[:space:]]|$)|\ytest[-_[:space:]]+(user|account|profile|course|mentor)\y|@[^[:space:]]+\.test\y|@example\.(test|invalid)\y`

/**
 * Hotfix (round G): People you may know. Every exclusion runs in SQL before the limit, over every
 * eligible member, so excluded people never use up the slots:
 * - the viewer; organisation and company profiles; inactive, not onboarded or synthetic profiles;
 * - any connection row with the viewer: accepted, or pending in either direction
 *   (a request the viewer received belongs in Invitations);
 * - members the viewer follows; blocks in either direction;
 * - members the viewer asked to connect whose request is gone, so it was declined (or withdrawn),
 *   within the declined-request window (social_action_events remembers each request).
 * The rest are ordered by the shared-attribute score, then most recently updated.
 */
function peopleSuggestionSql(roundG = false) {
  return `
  with viewer as (
    select
      vp.id,
      vp.profile_type,
      nullif(lower(btrim(vp.location)), '') as location,
      nullif(lower(btrim(vmp.rank)), '') as rank,
      coalesce((select array_agg(lower(btrim(value))) from unnest(vmp.vessel_types) value), '{}'::text[]) as vessel_types,
      coalesce((select array_agg(lower(btrim(value))) from unnest(vmp.trading_areas) value), '{}'::text[]) as trading_areas,
      coalesce((select array_agg(lower(btrim(vps.skill))) from public.profile_skills vps where vps.user_id = vp.id), '{}'::text[]) as skills
    from public.profiles vp
    left join public.maritime_profiles vmp on vmp.user_id = vp.id
    where vp.id = $1
  ),
  candidates as (
    select
      cp.id,
      cp.updated_at,
      (
        case when exists (select 1 from unnest(cmp.vessel_types) value where lower(btrim(value)) = any(viewer.vessel_types)) then $3::int else 0 end
        + case when exists (select 1 from public.profile_skills cps where cps.user_id = cp.id and lower(btrim(cps.skill)) = any(viewer.skills)) then $4::int else 0 end
        + case when exists (select 1 from unnest(cmp.trading_areas) value where lower(btrim(value)) = any(viewer.trading_areas)) then $5::int else 0 end
        + case when viewer.rank is not null and lower(btrim(cmp.rank)) = viewer.rank then $6::int else 0 end
        + case when cp.profile_type = viewer.profile_type then $7::int else 0 end
        + case when viewer.location is not null and lower(btrim(cp.location)) = viewer.location then $8::int else 0 end
      ) as score
    from public.profiles cp
    cross join viewer
    left join public.maritime_profiles cmp on cmp.user_id = cp.id
    where cp.id <> viewer.id
      and cp.account_status = 'active'
      and cp.onboarding_completed_at is not null
      and cp.slug is not null
      and coalesce(cp.identity_root, 'professional') <> 'organisation'
      and cp.profile_type is distinct from 'company'
      and not exists (
        select 1 from public.connections c
        where (c.user_low_id = viewer.id and c.user_high_id = cp.id)
           or (c.user_high_id = viewer.id and c.user_low_id = cp.id)
      )
      and not exists (
        select 1 from public.follows f
        where f.follower_id = viewer.id and f.following_id = cp.id
      )
      and not exists (
        select 1 from public.user_blocks b
        where (b.blocker_id = viewer.id and b.blocked_id = cp.id)
           or (b.blocker_id = cp.id and b.blocked_id = viewer.id)
      )
      and not exists (
        select 1 from public.social_action_events e
        where e.profile_id = viewer.id
          and e.action = 'connection_request'
          and e.target_profile_id = cp.id
          and e.created_at > now() - $9::interval
      )
      and not ${syntheticTextSql("concat_ws(' ', cp.slug, cp.full_name, cp.headline, cp.summary, cmp.rank, cmp.current_company)", '$10')}
      ${roundG ? ROUND_G_PEOPLE_EXCLUSIONS_SQL : ''}
    order by score desc, cp.updated_at desc, cp.id asc
    limit $2
  )
  ${PROFILE_SELECT}
  join candidates on candidates.id = p.id
  order by candidates.score desc, candidates.updated_at desc, p.id asc
`
}

const PROFILE_SELECT = `
  select
    p.id,
    p.slug,
    p.profile_type::text as profile_type,
    p.identity_root,
    p.primary_identity,
    p.primary_identity_family,
    p.secondary_identities,
    p.persona,
    p.profile_intents,
    p.community_relationship,
    p.institution_name,
    p.specialization,
    p.role_department_key,
    p.role_key,
    p.role_other_text,
    p.cadet_stage_key,
    p.cadet_course_key,
    p.target_department_key,
    p.target_role_key,
    p.occupation_text,
    p.full_name,
    p.avatar_path,
    p.cover_path,
    p.location,
    p.headline,
    p.summary,
    p.contact_visibility::text as contact_visibility,
    p.onboarding_completed_at,
    p.username_change_count,
    p.username_auto_generated,
    case
      when mp.user_id is null then null
      else json_build_object(
        'rank', mp.rank,
        'current_company', mp.current_company,
        'current_company_id', mp.current_company_id,
        'current_vessel', mp.current_vessel,
        'sailing_experience_years', mp.sailing_experience_years,
        'vessel_types', mp.vessel_types,
        'trading_areas', mp.trading_areas,
        'shore_career_preference', mp.shore_career_preference,
        'availability', mp.availability
      )
    end as maritime_profiles,
    case
      when linked_org.id is null then null
      else json_build_object(
        'id', linked_org.id,
        'slug', linked_org.slug,
        'name', linked_org.name,
        'has_logo', linked_org.logo_path is not null and btrim(linked_org.logo_path) <> '',
        'verified', coalesce(linked_org.is_verified, false),
        'unclaimed', ${organizationClaimStatusSql('linked_org')} = 'unclaimed'
      )
    end as current_organization,
    coalesce(
      (
        select json_agg(
          json_build_object('skill', ps.skill)
          order by ps.created_at asc, ps.skill asc
        )
        from public.profile_skills ps
        where ps.user_id = p.id
      ),
      '[]'::json
    ) as profile_skills
  from public.profiles p
  left join public.maritime_profiles mp on mp.user_id = p.id
  left join public.companies linked_org
    on linked_org.id = mp.current_company_id
   and ${listableOrganizationSql('linked_org')}
`

function isProfileType(value: unknown): value is ProfileType {
  return PROFILE_TYPES.includes(value as ProfileType)
}

function isIdentityRoot(value: unknown): value is IdentityRoot {
  return value === 'professional' || value === 'organisation'
}

function isPersona(value: unknown): value is Persona {
  return PERSONAS.includes(value as Persona)
}

function isProfileIntent(value: unknown): value is ProfileIntent {
  return PROFILE_INTENTS.includes(value as ProfileIntent)
}

function isContactVisibility(value: unknown): value is ContactVisibility {
  return value === 'private' || value === 'members' || value === 'public'
}

function normalizePublicRow(row: ProfileRow): PublicProfileRow | null {
  if (!row.slug || !isProfileType(row.profile_type)) return null

  return {
    id: row.id,
    slug: row.slug,
    profile_type: row.profile_type,
    identity_root: row.identity_root == null || isIdentityRoot(row.identity_root) ? row.identity_root : null,
    primary_identity: row.primary_identity ?? null,
    primary_identity_family: row.primary_identity_family ?? null,
    secondary_identities: Array.isArray(row.secondary_identities) ? row.secondary_identities : [],
    persona: row.persona == null || isPersona(row.persona) ? row.persona : null,
    profile_intents: Array.isArray(row.profile_intents)
      ? row.profile_intents.filter(isProfileIntent)
      : [],
    community_relationship: row.community_relationship ?? null,
    institution_name: row.institution_name ?? null,
    specialization: row.specialization ?? null,
    role_department_key: row.role_department_key ?? null,
    role_key: row.role_key ?? null,
    role_other_text: row.role_other_text ?? null,
    cadet_stage_key: row.cadet_stage_key ?? null,
    cadet_course_key: row.cadet_course_key ?? null,
    target_department_key: row.target_department_key ?? null,
    target_role_key: row.target_role_key ?? null,
    occupation_text: row.occupation_text ?? null,
    full_name: row.full_name,
    avatar_path: row.avatar_path,
    cover_path: row.cover_path ?? null,
    location: row.location,
    headline: row.headline,
    summary: row.summary,
    maritime_profiles: row.maritime_profiles,
    current_organization: row.current_organization ?? null,
    profile_skills: Array.isArray(row.profile_skills) ? row.profile_skills : [],
  }
}

function mapPublicRows(rows: readonly ProfileRow[]): PublicProfile[] {
  return rows.flatMap((row) => {
    const normalized = normalizePublicRow(row)
    return normalized ? [mapPublicProfile(normalized)] : []
  })
}

function blockVisibilitySql(viewerParameter: number) {
  return `
    and not exists (
      select 1
      from public.user_blocks b
      where (b.blocker_id = $${viewerParameter} and b.blocked_id = p.id)
         or (b.blocker_id = p.id and b.blocked_id = $${viewerParameter})
    )
  `
}

function requireAtMostOne(rows: readonly ProfileRow[]) {
  if (rows.length > 1) {
    throw new Error('Unable to load this professional profile.')
  }
  return rows[0] ?? null
}

/**
 * Round 14 (3.6): every token must appear in the stored, lower-cased profiles.search_text
 * (migration 0067, kept current by triggers on profiles, maritime_profiles and profile_skills).
 * One LIKE per token, not LIKE ALL, so the GIN trigram index can serve each of them.
 */
function storedSearchTextSql(tokenCount: number) {
  return Array.from({ length: tokenCount }, (_, index) => `and p.search_text like ($2::text[])[${index + 1}]`)
    .join('\n         ')
}

/** The text people search matched before migration 0067; public.profile_search_text() builds the same. */
const LEGACY_SEARCH_TEXT_SQL = `
         and lower(concat_ws(' ',
           p.full_name,
           p.slug,
           p.location,
           p.headline,
           p.summary,
           p.primary_identity,
           p.primary_identity_family,
           p.persona,
           array_to_string(p.profile_intents, ' '),
           p.community_relationship,
           p.institution_name,
           p.specialization,
           p.role_other_text,
           p.occupation_text,
           array_to_string(p.secondary_identities, ' '),
           mp.rank,
           mp.current_company,
           mp.current_vessel,
           array_to_string(mp.vessel_types, ' '),
           array_to_string(mp.trading_areas, ' '),
           coalesce((
             select string_agg(ps_search.skill, ' ' order by ps_search.skill)
             from public.profile_skills ps_search
             where ps_search.user_id = p.id
           ), '')
         )) like all($2::text[])
       `

function isMissingSearchTextColumn(error: unknown) {
  return typeof error === 'object' && error !== null
    && (error as { code?: unknown }).code === '42703'
    && /search_text/.test(String((error as { message?: unknown }).message ?? ''))
}

function searchTokens(value?: string) {
  return (value ?? '')
    .trim()
    .toLocaleLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 8)
}

export function createProfileRepository(input: { query?: ProfileQuery } = {}) {
  const queryRows: ProfileQuery = input.query ?? ((text, values) =>
    databaseQuery<ProfileRow>(text, values))

  async function getOwnProfile(profileId: string): Promise<OwnProfile | null> {
    const rows = await queryRows(
      `${PROFILE_SELECT}
       where p.id = $1
       limit 2`,
      [profileId],
    )
    const row = requireAtMostOne(rows)
    if (!row || !row.onboarding_completed_at || !isContactVisibility(row.contact_visibility)) {
      return null
    }

    const normalized = normalizePublicRow(row)
    if (!normalized) return null

    const ownRow: OwnProfileRow = {
      ...normalized,
      contact_visibility: row.contact_visibility,
      onboarding_completed_at: row.onboarding_completed_at,
      username_change_count: Number(row.username_change_count ?? 0),
    }

    return {
      ...mapPublicProfile(ownRow),
      contactVisibility: ownRow.contact_visibility,
      onboardingCompletedAt: ownRow.onboarding_completed_at as string,
      usernameChangeCount: ownRow.username_change_count,
      usernameAutoGenerated: row.username_auto_generated === true,
    }
  }

  async function getPublicProfileBySlug(
    lookup: PublicProfileBySlugLookup,
  ): Promise<PublicProfile | null> {
    const blocked = lookup.viewerProfileId ? blockVisibilitySql(2) : ''
    const values = lookup.viewerProfileId
      ? [lookup.slug, lookup.viewerProfileId]
      : [lookup.slug]
    const rows = await queryRows(
      `${PROFILE_SELECT}
       where p.slug = $1
         and p.account_status = 'active'
         and p.onboarding_completed_at is not null
         ${blocked}
       limit 2`,
      values,
    )
    const row = requireAtMostOne(rows)
    if (!row) return null

    const normalized = normalizePublicRow(row)
    return normalized ? mapPublicProfile(normalized) : null
  }

  async function getPublicProfileById(
    lookup: PublicProfileByIdLookup,
  ): Promise<PublicProfile | null> {
    const blocked = lookup.viewerProfileId ? blockVisibilitySql(2) : ''
    const values = lookup.viewerProfileId
      ? [lookup.profileId, lookup.viewerProfileId]
      : [lookup.profileId]
    const rows = await queryRows(
      `${PROFILE_SELECT}
       where p.id = $1
         and p.account_status = 'active'
         and p.onboarding_completed_at is not null
         ${blocked}
       limit 2`,
      values,
    )
    const row = requireAtMostOne(rows)
    if (!row) return null

    const normalized = normalizePublicRow(row)
    return normalized ? mapPublicProfile(normalized) : null
  }

  async function getPublicProfilesByIds(
    lookup: PublicProfilesByIdsLookup,
  ): Promise<PublicProfile[]> {
    if (lookup.ids.length === 0) return []

    const uniqueIds = [...new Set(lookup.ids)]
    const blocked = lookup.viewerProfileId ? blockVisibilitySql(2) : ''
    const values = lookup.viewerProfileId
      ? [uniqueIds, lookup.viewerProfileId]
      : [uniqueIds]
    const rows = await queryRows(
      `${PROFILE_SELECT}
       where p.id = any($1::uuid[])
         and p.account_status = 'active'
         and p.onboarding_completed_at is not null
         ${blocked}`,
      values,
    )

    const profiles = mapPublicRows(rows)
    const byId = new Map(profiles.map((profile) => [profile.id, profile]))
    return lookup.ids.flatMap((id) => {
      const profile = byId.get(id)
      return profile ? [profile] : []
    })
  }

  async function getDiscoveryCandidates(
    lookup: DiscoveryCandidateLookup,
  ): Promise<PublicProfile[]> {
    const limit = Math.min(Math.max(Math.trunc(lookup.limit), 1), 60)
    const tokens = searchTokens(lookup.searchQuery)
    const hasSearch = tokens.length > 0
    const limitParameter = hasSearch ? 3 : 2
    const values: readonly unknown[] = hasSearch
      ? [lookup.viewerProfileId, tokens.map((token) => `%${token}%`), limit]
      : [lookup.viewerProfileId, limit]
    const discoverySql = (searchSql: string) => `${PROFILE_SELECT}
       where p.id <> $1
         and p.account_status = 'active'
         and p.onboarding_completed_at is not null
         ${blockVisibilitySql(1)}
         ${searchSql}
       order by p.updated_at desc, p.id asc
       limit $${limitParameter}`

    if (!hasSearch) return mapPublicRows(await queryRows(discoverySql(''), values))

    try {
      return mapPublicRows(await queryRows(discoverySql(storedSearchTextSql(tokens.length)), values))
    } catch (error) {
      // Until migration 0067 adds profiles.search_text, search the same text built per query.
      if (!isMissingSearchTextColumn(error)) throw error
      return mapPublicRows(await queryRows(discoverySql(LEGACY_SEARCH_TEXT_SQL), values))
    }
  }

  async function getPeopleSuggestions(lookup: PeopleSuggestionLookup): Promise<PublicProfile[]> {
    const limit = Math.min(Math.max(Math.trunc(lookup.limit), 1), 60)
    const { weights } = lookup
    const rows = await queryRows(peopleSuggestionSql(Boolean(lookup.roundG)), [
      lookup.viewerProfileId,
      limit,
      weights.sharedVesselType,
      weights.sharedSkill,
      weights.sharedTradingArea,
      weights.rankMatch,
      weights.sameProfileType,
      weights.sameLocation,
      lookup.declinedRequestWindow,
      SYNTHETIC_PROFILE_PATTERN_SQL,
    ])
    return mapPublicRows(rows)
  }

  return {
    getOwnProfile,
    getPublicProfileBySlug,
    getPublicProfileById,
    getPublicProfilesByIds,
    getDiscoveryCandidates,
    getPeopleSuggestions,
  }
}

const profileRepository = createProfileRepository()

export const getOwnProfileFromAurora = profileRepository.getOwnProfile
export const getPublicProfileBySlugFromAurora = profileRepository.getPublicProfileBySlug
export const getPublicProfileByIdFromAurora = profileRepository.getPublicProfileById
export const getPublicProfilesByIdsFromAurora = profileRepository.getPublicProfilesByIds
export const getDiscoveryCandidatesFromAurora = profileRepository.getDiscoveryCandidates

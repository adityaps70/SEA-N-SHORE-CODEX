import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { mapPublicProfile } from './mappers'
import {
  PROFILE_TYPES,
  type ContactVisibility,
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
  full_name: string
  avatar_path: string | null
  location: string | null
  headline: string | null
  summary: string | null
  contact_visibility?: string | null
  onboarding_completed_at?: string | null
  maritime_profiles: PublicProfileRow['maritime_profiles']
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
}

const PROFILE_SELECT = `
  select
    p.id,
    p.slug,
    p.profile_type::text as profile_type,
    p.full_name,
    p.avatar_path,
    p.location,
    p.headline,
    p.summary,
    p.contact_visibility::text as contact_visibility,
    p.onboarding_completed_at,
    case
      when mp.user_id is null then null
      else json_build_object(
        'rank', mp.rank,
        'current_company', mp.current_company,
        'current_vessel', mp.current_vessel,
        'sailing_experience_years', mp.sailing_experience_years,
        'vessel_types', mp.vessel_types,
        'trading_areas', mp.trading_areas,
        'shore_career_preference', mp.shore_career_preference,
        'availability', mp.availability
      )
    end as maritime_profiles,
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
` as const

function isProfileType(value: unknown): value is ProfileType {
  return PROFILE_TYPES.includes(value as ProfileType)
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
    full_name: row.full_name,
    avatar_path: row.avatar_path,
    location: row.location,
    headline: row.headline,
    summary: row.summary,
    maritime_profiles: row.maritime_profiles,
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
    }

    return {
      ...mapPublicProfile(ownRow),
      contactVisibility: ownRow.contact_visibility,
      onboardingCompletedAt: ownRow.onboarding_completed_at as string,
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
    const rows = await queryRows(
      `${PROFILE_SELECT}
       where p.id <> $1
         and p.account_status = 'active'
         and p.onboarding_completed_at is not null
         ${blockVisibilitySql(1)}
       order by p.updated_at desc, p.id asc
       limit $2`,
      [lookup.viewerProfileId, limit],
    )

    return mapPublicRows(rows)
  }

  return {
    getOwnProfile,
    getPublicProfileBySlug,
    getPublicProfileById,
    getPublicProfilesByIds,
    getDiscoveryCandidates,
  }
}

const profileRepository = createProfileRepository()

export const getOwnProfileFromAurora = profileRepository.getOwnProfile
export const getPublicProfileBySlugFromAurora = profileRepository.getPublicProfileBySlug
export const getPublicProfileByIdFromAurora = profileRepository.getPublicProfileById
export const getPublicProfilesByIdsFromAurora = profileRepository.getPublicProfilesByIds
export const getDiscoveryCandidatesFromAurora = profileRepository.getDiscoveryCandidates

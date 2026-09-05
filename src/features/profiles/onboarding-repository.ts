import type { QueryResultRow } from 'pg'
import { query as databaseQuery, type DatabaseQueryClient } from '@/lib/db/client'
import type { OnboardingInput } from './schemas'

type OnboardingQuery = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

type AvailabilityRow = QueryResultRow & {
  id: string
  account_status: string
  onboarding_completed_at: string | null
}

type OnboardingProfileRow = QueryResultRow & {
  full_name: string
  onboarding_completed_at: string | null
}

type ReturningIdRow = QueryResultRow & { id: string }

export type OnboardingProfile = {
  fullName: string
  onboardingCompletedAt: string | null
}

export function createOnboardingRepository(input: { query: OnboardingQuery }) {
  const query = input.query

  async function getOnboardingProfile(profileId: string): Promise<OnboardingProfile | null> {
    const rows = await query(
      `select full_name, onboarding_completed_at
       from public.profiles
       where id = $1
         and account_status = 'active'
       limit 1`,
      [profileId],
    ) as OnboardingProfileRow[]
    const row = rows[0]
    return row ? {
      fullName: row.full_name,
      onboardingCompletedAt: row.onboarding_completed_at,
    } : null
  }

  async function lockOnboardingProfile(profileId: string) {
    const rows = await query(
      `select id, account_status::text as account_status, onboarding_completed_at
       from public.profiles
       where id = $1
       for update`,
      [profileId],
    ) as AvailabilityRow[]
    const row = rows[0]
    return Boolean(row && row.account_status === 'active' && row.onboarding_completed_at === null)
  }

  async function updateProfile(profileId: string, data: OnboardingInput) {
    await query(
      `update public.profiles
       set profile_type = $2,
           full_name = $3,
           slug = $4,
           location = $5,
           headline = $6,
           summary = $7,
           contact_visibility = $8,
           updated_at = now()
       where id = $1
         and account_status = 'active'
         and onboarding_completed_at is null`,
      [
        profileId,
        data.profileType,
        data.fullName,
        data.slug,
        data.location ?? null,
        data.headline,
        data.summary,
        data.contactVisibility,
      ],
    )
  }

  async function upsertMaritimeProfile(profileId: string, data: OnboardingInput) {
    await query(
      `insert into public.maritime_profiles (
         user_id, rank, current_company, current_vessel, sailing_experience_years,
         vessel_types, trading_areas, shore_career_preference, availability, updated_at
       ) values ($1, $2, $3, $4, $5, $6::text[], $7::text[], $8, $9, now())
       on conflict (user_id) do update set
         rank = excluded.rank,
         current_company = excluded.current_company,
         current_vessel = excluded.current_vessel,
         sailing_experience_years = excluded.sailing_experience_years,
         vessel_types = excluded.vessel_types,
         trading_areas = excluded.trading_areas,
         shore_career_preference = excluded.shore_career_preference,
         availability = excluded.availability,
         updated_at = now()`,
      [
        profileId,
        data.rank ?? null,
        data.currentCompany ?? null,
        data.currentVessel ?? null,
        data.sailingExperienceYears ?? null,
        data.vesselTypes,
        data.tradingAreas,
        data.shoreCareerPreference,
        data.availability ?? null,
      ],
    )
  }

  async function deleteMaritimeProfile(profileId: string) {
    await query(`delete from public.maritime_profiles where user_id = $1`, [profileId])
  }

  async function replaceSkills(profileId: string, skills: string[]) {
    await query(`delete from public.profile_skills where user_id = $1`, [profileId])
    if (!skills.length) return
    await query(
      `insert into public.profile_skills (user_id, skill)
       select $1, skill
       from unnest($2::text[]) as skill`,
      [profileId, skills],
    )
  }

  async function finalizeOnboarding(profileId: string) {
    const rows = await query(
      `update public.profiles
       set onboarding_completed_at = now(), updated_at = now()
       where id = $1
         and account_status = 'active'
         and onboarding_completed_at is null
       returning id`,
      [profileId],
    ) as ReturningIdRow[]
    return rows.length === 1 && rows[0]?.id === profileId
  }

  return {
    getOnboardingProfile,
    lockOnboardingProfile,
    updateProfile,
    upsertMaritimeProfile,
    deleteMaritimeProfile,
    replaceSkills,
    finalizeOnboarding,
  }
}

export type OnboardingRepository = ReturnType<typeof createOnboardingRepository>

export function createOnboardingRepositoryForClient(client: DatabaseQueryClient) {
  return createOnboardingRepository({
    query: async (text, values) => (await client.query(text, values)).rows,
  })
}

const onboardingRepository = createOnboardingRepository({
  query: async (text, values) => databaseQuery(text, values),
})

export const getOnboardingProfileFromAurora = onboardingRepository.getOnboardingProfile

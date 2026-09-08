import type { QueryResultRow } from 'pg'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type {
  ProfileAboutSectionInput,
  ProfileIdentitySectionInput,
  ProfileProfessionalSectionInput,
} from './profile-inline-schemas'

type ReturningIdRow = QueryResultRow & { id: string }

type TransactionRunner = <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => Promise<T>

function unavailable(): never {
  throw new Error('profile_edit_unavailable')
}

export function createProfileInlineEditService(input: { withTransaction: TransactionRunner }) {
  async function updateIdentity(
    profileId: string,
    data: ProfileIdentitySectionInput,
    isMaritime: boolean,
  ) {
    return input.withTransaction(async (client) => {
      const result = await client.query<ReturningIdRow>(
        `update public.profiles
         set full_name = $2,
             slug = $3,
             location = $4,
             headline = $5,
             contact_visibility = $6,
             updated_at = now()
         where id = $1
           and account_status = 'active'
           and onboarding_completed_at is not null
         returning id`,
        [
          profileId,
          data.fullName,
          data.slug,
          data.location ?? null,
          data.headline,
          data.contactVisibility,
        ],
      )
      if (result.rows[0]?.id !== profileId) unavailable()

      if (isMaritime) {
        await client.query(
          `insert into public.maritime_profiles (
             user_id, current_company, vessel_types, trading_areas, shore_career_preference, updated_at
           ) values ($1, $2, '{}'::text[], '{}'::text[], false, now())
           on conflict (user_id) do update set
             current_company = excluded.current_company,
             updated_at = now()`,
          [profileId, data.currentCompany ?? null],
        )
      }
      return true
    })
  }

  async function updateAbout(profileId: string, data: ProfileAboutSectionInput) {
    return input.withTransaction(async (client) => {
      const result = await client.query<ReturningIdRow>(
        `update public.profiles
         set summary = $2,
             updated_at = now()
         where id = $1
           and account_status = 'active'
           and onboarding_completed_at is not null
         returning id`,
        [profileId, data.summary],
      )
      if (result.rows[0]?.id !== profileId) unavailable()

      await client.query(`delete from public.profile_skills where user_id = $1`, [profileId])
      if (data.skills.length) {
        await client.query(
          `insert into public.profile_skills (user_id, skill)
           select $1, skill
           from unnest($2::text[]) as skill`,
          [profileId, data.skills],
        )
      }
      return true
    })
  }

  async function updateProfessional(profileId: string, data: ProfileProfessionalSectionInput) {
    return input.withTransaction(async (client) => {
      await client.query(
        `insert into public.maritime_profiles (
           user_id, rank, current_vessel, sailing_experience_years, vessel_types,
           trading_areas, shore_career_preference, availability, updated_at
         ) values ($1, $2, $3, $4, $5::text[], $6::text[], $7, $8, now())
         on conflict (user_id) do update set
           rank = excluded.rank,
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
          data.currentVessel ?? null,
          data.sailingExperienceYears ?? null,
          data.vesselTypes,
          data.tradingAreas,
          data.shoreCareerPreference,
          data.availability,
        ],
      )
      return true
    })
  }

  return { updateIdentity, updateAbout, updateProfessional }
}

const productionService = createProfileInlineEditService({
  withTransaction: (fn) => databaseTransaction(fn),
})

export const updateProfileIdentitySectionWithAurora = productionService.updateIdentity
export const updateProfileAboutSectionWithAurora = productionService.updateAbout
export const updateProfileProfessionalSectionWithAurora = productionService.updateProfessional

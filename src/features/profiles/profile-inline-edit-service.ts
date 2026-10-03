import type { QueryResultRow } from 'pg'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import type {
  ProfileAboutSectionInput,
  ProfileIdentitySectionInput,
  ProfileProfessionalSectionInput,
} from './profile-inline-schemas'
import type { ProfilePreferencesInput, RetainedPersonaDetails } from './profile-preferences'
import { createProfilePreferencesService } from './profile-preferences-service'

type ReturningIdRow = QueryResultRow & { id: string }
type LockedProfileRow = QueryResultRow & {
  slug: string | null
  username_change_count: number
  username_auto_generated?: boolean | null
}

type TransactionRunner = <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => Promise<T>

/** A profile type change saved with a card, through the same preferences service as Edit profile. */
export type ProfileCardPreferences = {
  data: ProfilePreferencesInput
  retained?: RetainedPersonaDetails
}

/** The organization shown in the header: a name, optionally linked to its Sea N Shore page. */
export type ProfileCurrentOrganization = {
  currentCompany?: string
  currentCompanyId?: string
}

async function savePreferencesWithClient(client: DatabaseQueryClient, profileId: string, preferences: ProfileCardPreferences) {
  // Same transaction: the preferences service runs on this client instead of opening its own.
  const service = createProfilePreferencesService({ withTransaction: (fn) => fn(client) })
  await service.updatePreferences(profileId, preferences.data, preferences.retained)
}

async function upsertCurrentOrganization(client: DatabaseQueryClient, profileId: string, organization: ProfileCurrentOrganization) {
  await client.query(
    `insert into public.maritime_profiles (
       user_id, current_company, current_company_id, vessel_types, trading_areas, shore_career_preference, updated_at
     ) values ($1, $2, $3::uuid, '{}'::text[], '{}'::text[], false, now())
     on conflict (user_id) do update set
       current_company = excluded.current_company,
       current_company_id = excluded.current_company_id,
       updated_at = now()`,
    [profileId, organization.currentCompany ?? null, organization.currentCompany ? organization.currentCompanyId ?? null : null],
  )
}

async function updateRank(client: DatabaseQueryClient, profileId: string, rank?: string) {
  // Round 10: only the rank column; a member without a maritime row has no rank to change.
  await client.query(
    `update public.maritime_profiles set rank = $2, updated_at = now() where user_id = $1`,
    [profileId, rank?.trim() ? rank.trim() : null],
  )
}

function unavailable(): never {
  throw new Error('profile_edit_unavailable')
}

function usernameLimit(): never {
  throw new Error('username_change_limit')
}

export function createProfileInlineEditService(input: { withTransaction: TransactionRunner }) {
  async function updateIdentity(
    profileId: string,
    data: ProfileIdentitySectionInput,
    isMaritime: boolean,
    options: { rankSubmitted?: boolean; preferences?: ProfileCardPreferences } = {},
  ) {
    return input.withTransaction(async (client) => {
      const locked = await client.query<LockedProfileRow>(
        `select slug, username_change_count, username_auto_generated
         from public.profiles
         where id = $1
           and account_status = 'active'
           and onboarding_completed_at is not null
         for update`,
        [profileId],
      )
      const current = locked.rows[0]
      if (!current) unavailable()
      if (
        (current.slug ?? '') !== data.slug
        && current.username_auto_generated !== true
        && Number(current.username_change_count ?? 0) >= 2
      ) {
        usernameLimit()
      }

      const result = await client.query<ReturningIdRow>(
        `update public.profiles
         set full_name = $2,
             username_change_count = username_change_count
               + case when slug is distinct from $3 and not username_auto_generated then 1 else 0 end,
             username_auto_generated = username_auto_generated and slug is not distinct from $3,
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

      // Round 11: a profile type change from the header saves first, so the organization and rank
      // below (linked to their Sea N Shore page, or cleared) are what stays.
      if (options.preferences) await savePreferencesWithClient(client, profileId, options.preferences)
      if (isMaritime) await upsertCurrentOrganization(client, profileId, data)
      if (options.rankSubmitted) await updateRank(client, profileId, data.rank)
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
           trading_areas, shore_career_preference, updated_at
         ) values ($1, $2, $3, $4, $5::text[], $6::text[], $7, now())
         on conflict (user_id) do update set
           rank = excluded.rank,
           current_vessel = excluded.current_vessel,
           sailing_experience_years = excluded.sailing_experience_years,
           vessel_types = excluded.vessel_types,
           trading_areas = excluded.trading_areas,
           shore_career_preference = excluded.shore_career_preference,
           updated_at = now()`,
        [
          profileId,
          data.rank ?? null,
          data.currentVessel ?? null,
          data.sailingExperienceYears ?? null,
          data.vesselTypes,
          data.tradingAreas,
          data.shoreCareerPreference,
        ],
      )
      return true
    })
  }

  /**
   * The Profile box of "Access & goals" (round 11): profile type, goals and the persona details it
   * shows, saved with the preferences service, then the organization and rank when submitted.
   */
  async function updateGoals(
    profileId: string,
    preferences: ProfileCardPreferences,
    options: { organization?: ProfileCurrentOrganization; rankSubmitted?: boolean; rank?: string } = {},
  ) {
    return input.withTransaction(async (client) => {
      await savePreferencesWithClient(client, profileId, preferences)
      if (options.organization) await upsertCurrentOrganization(client, profileId, options.organization)
      if (options.rankSubmitted) await updateRank(client, profileId, options.rank)
      return true
    })
  }

  /** The Organizations card (round 11): which organization the header shows, or none. */
  async function setCurrentOrganization(profileId: string, organization: ProfileCurrentOrganization) {
    return input.withTransaction(async (client) => {
      await upsertCurrentOrganization(client, profileId, organization)
      return true
    })
  }

  return { updateIdentity, updateAbout, updateProfessional, updateGoals, setCurrentOrganization }
}

const productionService = createProfileInlineEditService({
  withTransaction: (fn) => databaseTransaction(fn),
})

export const updateProfileIdentitySectionWithAurora = productionService.updateIdentity
export const updateProfileAboutSectionWithAurora = productionService.updateAbout
export const updateProfileProfessionalSectionWithAurora = productionService.updateProfessional
export const updateProfileGoalsSectionWithAurora = productionService.updateGoals
export const setProfileCurrentOrganizationWithAurora = productionService.setCurrentOrganization

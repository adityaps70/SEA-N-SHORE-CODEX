import type { QueryResultRow } from 'pg'
import { withTransaction as databaseTransaction, type DatabaseQueryClient } from '@/lib/db/client'
import { profilePreferenceProjection, type ProfilePreferencesInput } from './profile-preferences'

type ReturningIdRow = QueryResultRow & { id: string }
type TransactionRunner = <T>(fn: (client: DatabaseQueryClient) => Promise<T>) => Promise<T>

export function createProfilePreferencesService(input: { withTransaction: TransactionRunner }) {
  async function updatePreferences(profileId: string, data: ProfilePreferencesInput) {
    const projection = profilePreferenceProjection(data)

    return input.withTransaction(async (client) => {
      const updated = await client.query<ReturningIdRow>(
        `update public.profiles
         set profile_type = $2,
             persona = $3,
             profile_intents = $4::text[],
             community_relationship = $5,
             institution_name = $6,
             specialization = $7,
             updated_at = now()
         where id = $1
           and account_status = 'active'
           and onboarding_completed_at is not null
         returning id`,
        [
          profileId,
          projection.profileType,
          projection.persona,
          projection.profileIntents,
          projection.communityRelationship,
          projection.institutionName,
          projection.specialization,
        ],
      )
      if (updated.rows[0]?.id !== profileId) throw new Error('profile_edit_unavailable')

      if (projection.currentCompany !== null || projection.rank !== null) {
        await client.query(
          `insert into public.maritime_profiles (
             user_id, rank, current_company, vessel_types, trading_areas, shore_career_preference, updated_at
           )
           values ($1, $2, $3, '{}'::text[], '{}'::text[], false, now())
           on conflict (user_id) do update set
             rank = case when $4 then excluded.rank else public.maritime_profiles.rank end,
             current_company = excluded.current_company,
             updated_at = now()`,
          [
            profileId,
            projection.rank,
            projection.currentCompany,
            projection.persona === 'seafarer',
          ],
        )
      }

      return true
    })
  }

  return { updatePreferences }
}

const productionService = createProfilePreferencesService({
  withTransaction: (fn) => databaseTransaction(fn),
})

export const updateProfilePreferencesWithAurora = productionService.updatePreferences

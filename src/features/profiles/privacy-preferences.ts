import { query as databaseQuery } from '@/lib/db/client'

/**
 * Round G (G2): two privacy switches in Settings › Privacy.
 * - "Show me in People you may know" (default on).
 * - "Let recruiters find me as open to work" (default off; offered to seafarers and shore professionals only).
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export type PrivacyPreferences = { showInPeopleSuggestions: boolean; openToRecruiters: boolean }
export type PrivacyPreferenceKey = keyof PrivacyPreferences

/** Personas that may be found by recruiters as open to work. */
export const OPEN_TO_WORK_PERSONAS = ['seafarer', 'shore_professional'] as const

export function canBeOpenToRecruiters(persona: string | null | undefined) {
  return (OPEN_TO_WORK_PERSONAS as readonly (string | null | undefined)[]).includes(persona)
}

export function createPrivacyPreferences(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))

  async function get(profileId: string): Promise<PrivacyPreferences> {
    const rows = await queryRows(
      `select show_in_people_suggestions, open_to_recruiters from public.member_preferences where profile_id = $1`,
      [profileId],
    )
    return {
      showInPeopleSuggestions: rows[0]?.show_in_people_suggestions !== false,
      openToRecruiters: rows[0]?.open_to_recruiters === true,
    }
  }

  async function set(profileId: string, key: PrivacyPreferenceKey, value: boolean) {
    const column = key === 'showInPeopleSuggestions' ? 'show_in_people_suggestions' : 'open_to_recruiters'
    await queryRows(
      `insert into public.member_preferences (profile_id, ${column}, updated_at) values ($1, $2, now())
       on conflict (profile_id) do update set ${column} = excluded.${column}, updated_at = now()`,
      [profileId, value],
    )
    if (key === 'showInPeopleSuggestions' && !value) {
      // Leave everyone's precomputed lists at once, not at the next nightly run.
      await queryRows(`delete from public.people_suggestions where candidate_id = $1`, [profileId])
    }
  }

  return { get, set }
}

export const privacyPreferences = createPrivacyPreferences()

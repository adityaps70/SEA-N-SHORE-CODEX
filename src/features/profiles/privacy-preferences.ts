import { query as databaseQuery } from '@/lib/db/client'
import {
  DEFAULT_CONNECTIONS_VISIBILITY,
  DEFAULT_MESSAGE_PERMISSION,
  connectionsVisibilityFrom,
  messagePermissionFrom,
  type ConnectionsVisibility,
  type MessagePermission,
} from './privacy-choices'

/**
 * Round G (G2): two privacy switches in Settings › Privacy.
 * - "Show me in People you may know" (default on).
 * - "Let recruiters find me as open to work" (default off; offered to seafarers and shore professionals only).
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<Array<Record<string, unknown>>>

export type PrivacyPreferences = { showInPeopleSuggestions: boolean; openToRecruiters: boolean; allowSearchIndexing: boolean }
export type PrivacyPreferenceKey = keyof PrivacyPreferences

/** Round H (H5): every switch key, for validating what the settings page sends. */
export const PRIVACY_PREFERENCE_KEYS = ['showInPeopleSuggestions', 'openToRecruiters', 'allowSearchIndexing'] as const satisfies readonly PrivacyPreferenceKey[]

export function isPrivacyPreferenceKey(value: unknown): value is PrivacyPreferenceKey {
  return (PRIVACY_PREFERENCE_KEYS as readonly unknown[]).includes(value)
}

export const DEFAULT_PRIVACY_PREFERENCES: PrivacyPreferences = { showInPeopleSuggestions: true, openToRecruiters: false, allowSearchIndexing: false }

const PREFERENCE_COLUMNS: Record<PrivacyPreferenceKey, string> = {
  showInPeopleSuggestions: 'show_in_people_suggestions',
  openToRecruiters: 'open_to_recruiters',
  // Round H (H5): "Let search engines show my profile" (off by default, migration 0088).
  allowSearchIndexing: 'allow_search_indexing',
}

/** Personas that may be found by recruiters as open to work. */
export const OPEN_TO_WORK_PERSONAS = ['seafarer', 'shore_professional'] as const

export function canBeOpenToRecruiters(persona: string | null | undefined) {
  return (OPEN_TO_WORK_PERSONAS as readonly (string | null | undefined)[]).includes(persona)
}

export function createPrivacyPreferences(input: { query?: Query } = {}) {
  const queryRows: Query = input.query ?? ((text, values) => databaseQuery(text, values))

  async function get(profileId: string): Promise<PrivacyPreferences> {
    const rows = await queryRows(
      `select show_in_people_suggestions, open_to_recruiters, allow_search_indexing from public.member_preferences where profile_id = $1`,
      [profileId],
    )
    return {
      showInPeopleSuggestions: rows[0]?.show_in_people_suggestions !== false,
      openToRecruiters: rows[0]?.open_to_recruiters === true,
      allowSearchIndexing: rows[0]?.allow_search_indexing === true,
    }
  }

  /**
   * Round H (H5): whether the member lets search engines list their public profile page. No row, or a
   * failed read, means no: the page then carries noindex and stays out of the sitemap.
   */
  async function allowsSearchIndexing(profileId: string): Promise<boolean> {
    try {
      const rows = await queryRows(
        `select allow_search_indexing from public.member_preferences where profile_id = $1`,
        [profileId],
      )
      return rows[0]?.allow_search_indexing === true
    } catch {
      return false
    }
  }

  async function set(profileId: string, key: PrivacyPreferenceKey, value: boolean) {
    const column = PREFERENCE_COLUMNS[key]
    if (!column) throw new Error('Unknown privacy setting.')
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

  /** Round H (H2): "Who can message me" and "Who can see my connections". */
  async function getChoices(profileId: string): Promise<PrivacyChoices> {
    const rows = await queryRows(
      `select message_permission, connections_visibility from public.member_preferences where profile_id = $1`,
      [profileId],
    )
    return {
      messagePermission: messagePermissionFrom(rows[0]?.message_permission),
      connectionsVisibility: connectionsVisibilityFrom(rows[0]?.connections_visibility),
    }
  }

  async function setChoice<K extends PrivacyChoiceKey>(profileId: string, key: K, value: PrivacyChoices[K]) {
    const column = key === 'messagePermission' ? 'message_permission' : 'connections_visibility'
    await queryRows(
      `insert into public.member_preferences (profile_id, ${column}, updated_at) values ($1, $2, now())
       on conflict (profile_id) do update set ${column} = excluded.${column}, updated_at = now()`,
      [profileId, value],
    )
  }

  return { get, set, allowsSearchIndexing, getChoices, setChoice }
}

export type PrivacyChoices = { messagePermission: MessagePermission; connectionsVisibility: ConnectionsVisibility }
export type PrivacyChoiceKey = keyof PrivacyChoices
export const DEFAULT_PRIVACY_CHOICES: PrivacyChoices = {
  messagePermission: DEFAULT_MESSAGE_PERMISSION,
  connectionsVisibility: DEFAULT_CONNECTIONS_VISIBILITY,
}

export const privacyPreferences = createPrivacyPreferences()

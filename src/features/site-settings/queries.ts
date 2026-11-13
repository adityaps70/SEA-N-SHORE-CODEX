import { createSharedCache } from '@/lib/server/shared-cache'
import type { QueryResultRow } from 'pg'
import { query as databaseQuery } from '@/lib/db/client'
import { siteSettingsRepository } from './repository'
import { SITE_SETTING_DEFAULTS, type AboutPageContent, type GrievanceOfficer, type MemberNumbersChoice } from './schemas'

/**
 * Round H (H7): public reads of the admin-edited settings. A database error (or a database without
 * migration 0089 yet) reads as the default, so the Contact and About pages still render with the
 * sections left out.
 */
type Query = (text: string, values?: readonly unknown[]) => Promise<QueryResultRow[]>

function logReadFailure(key: string, error: unknown) {
  console.warn('[site_settings_read_failed]', { key, code: (error as { code?: string } | null)?.code ?? null })
}

export async function getGrievanceOfficer(): Promise<GrievanceOfficer> {
  try {
    return await siteSettingsRepository.get('grievance_officer')
  } catch (error) {
    logReadFailure('grievance_officer', error)
    return SITE_SETTING_DEFAULTS.grievance_officer
  }
}

export async function getAboutPageContent(): Promise<AboutPageContent> {
  try {
    return await siteSettingsRepository.get('about_page')
  } catch (error) {
    logReadFailure('about_page', error)
    return SITE_SETTING_DEFAULTS.about_page
  }
}

export type MemberNumber = { key: 'members' | 'organizations' | 'courses'; label: string; value: number }

const MEMBER_NUMBER_LABELS: Record<MemberNumber['key'], { one: string; many: string }> = {
  members: { one: 'member', many: 'members' },
  organizations: { one: 'verified organization', many: 'verified organizations' },
  courses: { one: 'published course', many: 'published courses' },
}

/**
 * Live counts from existing tables, only the ones the admin chose, and only numbers above zero:
 * members = active profiles that finished onboarding; organizations = verified organization pages;
 * courses = live published courses (not removed, not a revision draft).
 */
// Round CAP (shared cache): the About page's live member numbers, the same for every viewer.
const memberNumbersCache = createSharedCache<MemberNumber[]>({ name: 'member_numbers', ttlMs: 30_000, maxEntries: 16 })

export async function getMemberNumbers(choice: MemberNumbersChoice, query?: Query): Promise<MemberNumber[]> {
  if (query) return readMemberNumbers(choice, query)
  const key = [choice.enabled, choice.members, choice.organizations, choice.courses].map((value) => (value ? 1 : 0)).join('')
  return [...await memberNumbersCache.get(key, () => readMemberNumbers(choice, (text, values) => databaseQuery<QueryResultRow>(text, values)))]
}

async function readMemberNumbers(choice: MemberNumbersChoice, query: Query): Promise<MemberNumber[]> {
  if (!choice.enabled || !(choice.members || choice.organizations || choice.courses)) return []
  try {
    const rows = await query(
      `select
         case when $1::boolean then (select count(*) from public.profiles p where p.account_status = 'active' and p.onboarding_completed_at is not null and not p.is_load_test) else 0 end as members,
         case when $2::boolean then (select count(*) from public.companies c where c.is_verified = true) else 0 end as organizations,
         case when $3::boolean then (select count(*) from public.learning_courses lc where lc.status = 'published' and lc.removed_at is null and lc.revision_of_course_id is null) else 0 end as courses`,
      [choice.members, choice.organizations, choice.courses],
    )
    const row = rows[0] ?? {}
    return (['members', 'organizations', 'courses'] as const)
      .filter((key) => choice[key])
      .map((key) => {
        const value = Number(row[key] ?? 0)
        const label = MEMBER_NUMBER_LABELS[key]
        return { key, value, label: value === 1 ? label.one : label.many }
      })
      .filter((entry) => Number.isFinite(entry.value) && entry.value > 0)
  } catch (error) {
    logReadFailure('member_numbers', error)
    return []
  }
}

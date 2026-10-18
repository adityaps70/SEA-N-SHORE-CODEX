import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { getMemberNumbers } from './queries'
import { createSiteSettingsRepository, SiteSettingValidationError } from './repository'
import { SITE_SETTING_DEFAULTS } from './schemas'

/**
 * Round H (H7) against the real schema (PGlite, every migration including 0089): typed site settings with
 * an audit row per change, and the About page's live member numbers. Placeholder data only.
 */
let db: TestDatabase
let admin: string

const query = (text: string, values?: readonly unknown[]) => db.query(text, values)
const transaction = <T,>(work: (run: typeof query) => Promise<T>) => db.transaction((tx) => work(tx))

beforeAll(async () => {
  db = await createTestDatabase()
  // Test-only, as in the other ranking tests: onboarded placeholder profiles without every identity field.
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
  const rows = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Admin') returning id`)
  admin = String(rows[0]!.id)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('site settings', () => {
  it('reads the default (empty) values until something is saved', async () => {
    const repo = createSiteSettingsRepository({ query, transaction })
    expect(await repo.get('grievance_officer')).toEqual(SITE_SETTING_DEFAULTS.grievance_officer)
    expect(await repo.get('about_page')).toEqual(SITE_SETTING_DEFAULTS.about_page)
  })

  it('saves a validated value with who changed it, and audits the previous and new value', async () => {
    const repo = createSiteSettingsRepository({ query, transaction })
    const first = { name: 'Placeholder Officer', email: 'GRIEVANCE@example.com', responseTime: 'Within 15 days' }
    expect(await repo.set('grievance_officer', first, admin)).toEqual({ ...first, email: 'grievance@example.com' })
    await repo.set('grievance_officer', { name: '', email: '', responseTime: '' }, admin)

    expect(await repo.get('grievance_officer')).toEqual({ name: '', email: '', responseTime: '' })
    const [row] = await db.query(`select updated_by from public.site_settings where key = 'grievance_officer'`)
    expect(row!.updated_by).toBe(admin)
    const audit = await db.query(
      `select action, target_type, target_id, actor_id, metadata from public.audit_events where target_type = 'site_setting' order by created_at, id`,
    )
    expect(audit).toHaveLength(2)
    expect(audit[0]).toMatchObject({ action: 'site_setting.updated', target_id: 'grievance_officer', actor_id: admin })
    expect(audit[0]!.metadata).toMatchObject({ key: 'grievance_officer', previous: null, next: { name: 'Placeholder Officer' } })
    expect(audit[1]!.metadata).toMatchObject({ previous: { name: 'Placeholder Officer' }, next: { name: '' } })
  })

  it('refuses an invalid value and changes nothing', async () => {
    const repo = createSiteSettingsRepository({ query, transaction })
    await expect(repo.set('grievance_officer', { name: 'Only A Name', email: '', responseTime: '' }, admin)).rejects.toBeInstanceOf(SiteSettingValidationError)
    expect(await repo.get('grievance_officer')).toEqual({ name: '', email: '', responseTime: '' })
    await expect(db.query(`insert into public.site_settings (key, value) values ('Bad Key', '{}')`)).rejects.toThrow()
  })

  it('reads a stored value that no longer validates as the default', async () => {
    await db.query(`insert into public.site_settings (key, value) values ('about_page', '{"founders": "not a list"}') on conflict (key) do update set value = excluded.value`)
    const repo = createSiteSettingsRepository({ query, transaction })
    expect(await repo.get('about_page')).toEqual(SITE_SETTING_DEFAULTS.about_page)
  })
})

describe('About page member numbers', () => {
  it('counts active onboarded members, verified organizations and live courses, only when switched on', async () => {
    const owner = admin
    await db.query(`update public.profiles set onboarding_completed_at = now(), account_status = 'active' where id = $1`, [owner])
    await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Unfinished')`)
    await db.query(`insert into public.companies (slug, name, created_by, is_verified) values ('placeholder-verified', 'Placeholder Verified', $1, true), ('placeholder-unverified', 'Placeholder Unverified', $1, false)`, [owner])

    expect(await getMemberNumbers({ enabled: false, members: true, organizations: true, courses: true }, query)).toEqual([])
    const numbers = await getMemberNumbers({ enabled: true, members: true, organizations: true, courses: true }, query)
    expect(numbers).toEqual([
      { key: 'members', value: 1, label: 'member' },
      { key: 'organizations', value: 1, label: 'verified organization' },
    ])
    expect(await getMemberNumbers({ enabled: true, members: false, organizations: true, courses: false }, query)).toEqual([
      { key: 'organizations', value: 1, label: 'verified organization' },
    ])
  })
})

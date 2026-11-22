import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createAdminRepository } from '@/features/admin/repository'
import { createCountryAdminRepository } from './repository'

/**
 * Round GP Part E (E4), against the real schema (PGlite, every migration): a Philippines country admin with
 * Moderation sees and decides reports on their countries' items only (a post's organization or else its author, a
 * comment's author, an event's organizer or else its host, a group's owner); a reported member profile is view only;
 * with Events only they see their countries' events and can cancel or restore an event through its report, nothing
 * else. Every decision is audited with the section and country; platform administrators keep every power.
 */
let db: TestDatabase
type Row = Record<string, unknown>
const run = (text: string, values?: readonly unknown[]) => db.query(text, values ? [...values] : undefined) as Promise<Row[]>
const transaction = async <T,>(work: (query: typeof run) => Promise<T>) => db.transaction((query) => work(query as typeof run))
let sequence = 0

let platformAdmin = ''
let partner = ''
let reporter = ''

async function profile(name: string, residence: string | null) {
  sequence += 1
  return String((await run(
    `insert into public.profiles (id, full_name, slug, profile_type, headline, summary, onboarding_completed_at, country_of_residence)
     values (gen_random_uuid(), $1, $2, 'seafarer', 'Placeholder headline', 'Placeholder summary for a test member.', now(), $3)
     returning id`,
    [name, `placeholder-moderation-${sequence}`, residence],
  ))[0]!.id)
}

async function company(country: string | null) {
  sequence += 1
  return String((await run(
    `insert into public.companies (slug, name, created_by, country) values ($1, 'Placeholder Org', $2, $3) returning id`,
    [`placeholder-moderation-org-${sequence}`, platformAdmin, country],
  ))[0]!.id)
}

async function post(authorId: string, companyId: string | null = null) {
  return String((await run(
    `insert into public.posts (author_id, category, body, post_type, company_id) values ($1, 'technical_discussion', 'Placeholder text', 'standard', $2) returning id`,
    [authorId, companyId],
  ))[0]!.id)
}

async function event(hostId: string, companyId: string | null = null) {
  return String((await run(
    `insert into public.events (host_user_id, company_id, title, summary, format, status, start_at, end_at, timezone, meeting_url)
     values ($1, $2, 'Placeholder Event', 'A placeholder event.', 'online', 'published', now() + interval '7 days', now() + interval '7 days 2 hours', 'UTC', 'https://meet.placeholder.example/room')
     returning id`,
    [hostId, companyId],
  ))[0]!.id)
}

async function report(targetType: string, targetId: string) {
  await run(`insert into public.content_reports (target_type, target_id, reporter_id, reason, status) values ($1, $2, $3, 'spam', 'open')`, [targetType, targetId, reporter])
}

const admin = () => createAdminRepository({ query: run, transaction, countrySchemaReady: async () => true })
const countryAdmins = () => createCountryAdminRepository({ query: run, transaction })
const caseIds = async (userId: string, section?: 'moderation' | 'events') =>
  (await admin().listModerationCases(userId, { status: 'open', targetType: 'all', limit: 100 }, section ? { section } : {})).map((item) => item.targetId).sort()

const ids: Record<string, string> = {}

beforeAll(async () => {
  db = await createTestDatabase()
  platformAdmin = await profile('Placeholder Admin', null)
  await run(`insert into public.user_roles (user_id, role) values ($1, 'administrator')`, [platformAdmin])
  partner = await profile('Placeholder Partner', 'PH')
  reporter = await profile('Placeholder Reporter', null)
  const manila = await profile('Placeholder Manila', 'PH')
  const kochi = await profile('Placeholder Kochi', 'IN')
  const phCompany = await company('PH')

  ids.phPost = await post(manila)
  ids.inPost = await post(kochi)
  // A post published as an organization follows the organization, not the author.
  ids.phCompanyPost = await post(kochi, phCompany)
  ids.phEvent = await event(kochi, phCompany)
  ids.inEvent = await event(kochi)
  ids.phProfile = manila
  for (const [type, key] of [['post', 'phPost'], ['post', 'inPost'], ['post', 'phCompanyPost'], ['event', 'phEvent'], ['event', 'inEvent'], ['profile', 'phProfile']] as const) {
    await report(type, ids[key]!)
  }
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('Moderation for a Philippines country admin', () => {
  it('needs the section, then lists only their countries’ reports, the reported profile included', async () => {
    await countryAdmins().grant(platformAdmin, partner, ['PH'])
    await expect(caseIds(partner)).rejects.toThrow('admin_forbidden')
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', moderation: 'view' })
    expect(await caseIds(partner)).toEqual([ids.phPost, ids.phCompanyPost, ids.phEvent, ids.phProfile].sort())
    expect((await caseIds(platformAdmin)).length).toBe(6)
  })

  it('needs "act", decides only their countries, never a member profile, and audits the section and country', async () => {
    await expect(admin().moderateContent(partner, { targetType: 'post', targetId: ids.phPost!, action: 'remove', note: 'Placeholder note.' })).rejects.toThrow('admin_forbidden')
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', moderation: 'act' })
    await expect(admin().moderateContent(partner, { targetType: 'post', targetId: ids.inPost!, action: 'remove', note: 'Placeholder note.' })).rejects.toThrow('moderation_out_of_scope')
    await expect(admin().moderateContent(partner, { targetType: 'profile', targetId: ids.phProfile!, action: 'remove', note: 'Placeholder note.' })).rejects.toThrow('moderation_profile_platform_only')
    await expect(admin().moderateContent(partner, { targetType: 'profile', targetId: ids.phProfile!, action: 'dismiss', note: 'Placeholder note.' })).rejects.toThrow('moderation_profile_platform_only')
    expect(await run(`select account_status::text as status from public.profiles where id = $1`, [ids.phProfile])).toEqual([{ status: 'active' }])

    await admin().moderateContent(partner, { targetType: 'post', targetId: ids.phPost!, action: 'remove', note: 'Placeholder note.' })
    expect((await run(`select deleted_at from public.posts where id = $1`, [ids.phPost]))[0]!.deleted_at).not.toBeNull()
    const [audit] = await run(`select metadata from public.audit_events where target_id = $1 and action = 'moderation.content_removed'`, [ids.phPost])
    expect(audit!.metadata).toMatchObject({ actorRole: 'country_admin', section: 'moderation', country: 'PH' })
  })
})

describe('Events for a Philippines country admin', () => {
  it('lists only their countries’ events and event reports', async () => {
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', events: 'view' })
    expect((await admin().listCountryEvents(partner)).map((item) => item.id)).toEqual([ids.phEvent])
    expect(await caseIds(partner, 'events')).toEqual([ids.phEvent])
    await expect(caseIds(partner, 'moderation')).rejects.toThrow('admin_forbidden')
    expect((await admin().listCountryEvents(platformAdmin)).map((item) => item.id).sort()).toEqual([ids.phEvent, ids.inEvent].sort())
  })

  it('with "act", cancels and restores their countries’ events through reports, and does nothing else', async () => {
    await expect(admin().moderateContent(partner, { targetType: 'event', targetId: ids.phEvent!, action: 'remove', note: 'Placeholder note.' })).rejects.toThrow('admin_forbidden')
    await countryAdmins().grant(platformAdmin, partner, ['PH'], { organizations: 'act', events: 'act' })
    await expect(admin().moderateContent(partner, { targetType: 'event', targetId: ids.phEvent!, action: 'dismiss', note: 'Placeholder note.' })).rejects.toThrow('admin_forbidden')
    await expect(admin().moderateContent(partner, { targetType: 'post', targetId: ids.phCompanyPost!, action: 'remove', note: 'Placeholder note.' })).rejects.toThrow('admin_forbidden')
    await expect(admin().moderateContent(partner, { targetType: 'event', targetId: ids.inEvent!, action: 'remove', note: 'Placeholder note.' })).rejects.toThrow('moderation_out_of_scope')

    await admin().moderateContent(partner, { targetType: 'event', targetId: ids.phEvent!, action: 'remove', note: 'Placeholder note.' })
    expect(await run(`select status from public.events where id = $1`, [ids.phEvent])).toEqual([{ status: 'cancelled' }])
    await admin().moderateContent(partner, { targetType: 'event', targetId: ids.phEvent!, action: 'restore', note: 'Placeholder note.' })
    expect(await run(`select status from public.events where id = $1`, [ids.phEvent])).toEqual([{ status: 'published' }])
    const audits = await run(`select metadata from public.audit_events where target_id = $1 and action like 'moderation.content_%' order by id`, [ids.phEvent])
    expect(audits.map((row) => row.metadata)).toEqual([
      expect.objectContaining({ actorRole: 'country_admin', section: 'events', country: 'PH' }),
      expect.objectContaining({ actorRole: 'country_admin', section: 'events', country: 'PH' }),
    ])
  })

  it('leaves platform administrators every power, member profiles included', async () => {
    await admin().moderateContent(platformAdmin, { targetType: 'profile', targetId: ids.phProfile!, action: 'dismiss', note: 'Placeholder note.' })
    const [audit] = await run(`select metadata from public.audit_events where target_id = $1 and action = 'moderation.dismiss'`, [ids.phProfile])
    expect(audit!.metadata).toMatchObject({ actorRole: 'platform_admin', section: 'moderation', country: 'PH' })
  })
})

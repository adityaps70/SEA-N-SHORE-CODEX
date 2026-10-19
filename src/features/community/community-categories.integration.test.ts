import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { CommunityCategoryError, createCommunityCategoryRepository } from './category-repository'
import { createCommunityRepository } from './repository'
import { createCommunityService } from './service'

/**
 * Round I (I2) against the real schema (PGlite with every migration, including 0093): the backfill, the admin
 * changes and their audit rows, the in-use delete rule, the order of the chips and the hidden-category rule.
 * Placeholder data only.
 */
let db: TestDatabase
let adminId: string
let memberId: string

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
  adminId = String((await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Admin') returning id`))[0]!.id)
  memberId = String((await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Member') returning id`))[0]!.id)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

const categories = () => createCommunityCategoryRepository({ query: db.query, transaction: db.transaction })
const communities = () => createCommunityRepository({ query: db.query })
const service = () => createCommunityService({ repository: communities(), categories: categories(), canAccessPlatformAdmin: async () => false })

async function newCommunity(name: string, categoryId: string | null) {
  return service().createGroup(memberId, { name, description: '', rules: '', visibility: 'public', icon: null, ownerId: memberId, categoryId })
}

async function auditActions() {
  return (await db.query(`select action from public.audit_events where target_type = 'community_category' order by id`)).map((row) => row.action)
}

describe('migration 0093 backfill', () => {
  it('creates the nine categories with the old names in the old order, and gives every community its old category', async () => {
    const all = await categories().listAll()
    expect(all.map((category) => category.name)).toEqual([
      'Maritime News', 'Technical Discussion', 'Vetting & SIRE 2.0', 'Career Advice', 'Safety Lessons', 'Achievement', 'Learning', 'Industry Opinion', 'Other',
    ])
    expect(all.map((category) => category.slug)).toContain('vetting-sire-2-0')
    await expect(db.query(`select count(*)::int as n from public.community_groups where category_id is null`)).resolves.toEqual([{ n: 0 }])
    await expect(db.query(`
      select count(*)::int as n from public.community_groups g join public.community_categories c on c.id = g.category_id
      where c.legacy_key is distinct from coalesce(g.category, 'other')`)).resolves.toEqual([{ n: 0 }])
  })

  it('maps a community without a category to Other, and one with an old value to its category (the backfill statement)', async () => {
    const rows = await db.query(
      `insert into public.community_groups (name, slug, category) values ('Old Learning Group', 'old-learning-group', 'learning'), ('Old Plain Group', 'old-plain-group', null) returning id`,
    )
    await db.query(`update public.community_groups g set category_id = c.id from public.community_categories c where g.category_id is null and c.legacy_key = coalesce(g.category, 'other');`)
    const mapped = await db.query(
      `select g.slug, c.slug as category from public.community_groups g join public.community_categories c on c.id = g.category_id where g.id = any($1::uuid[]) order by g.slug`,
      [rows.map((row) => row.id)],
    )
    expect(mapped).toEqual([{ slug: 'old-learning-group', category: 'learning' }, { slug: 'old-plain-group', category: 'other' }])
  })
})

describe('Admin › Communities › Categories', () => {
  it('creates a category with a slug from its name, refuses a duplicate name or a name over 40 characters, and audits every change', async () => {
    const created = await categories().create(adminId, { name: '  Offshore &  Energy ', description: 'Rigs, wind and FPSOs.', icon: 'LifeBuoy' })
    expect(created).toMatchObject({ slug: 'offshore-and-energy', name: 'Offshore & Energy', icon: 'LifeBuoy', hidden: false })
    await expect(categories().create(adminId, { name: 'offshore & energy' })).rejects.toMatchObject({ code: 'category_name_taken' })
    await expect(categories().create(adminId, { name: 'x'.repeat(41) })).rejects.toMatchObject({ code: 'category_name_invalid' })
    await expect(categories().create(adminId, { name: 'Bad icon', icon: 'Rocket' })).rejects.toMatchObject({ code: 'category_icon_invalid' })

    await categories().update(adminId, created.id, { name: 'Offshore and Energy', description: null, icon: null })
    const renamed = (await categories().listAll()).find((category) => category.id === created.id)!
    // The slug stays, so links keep working.
    expect(renamed).toMatchObject({ name: 'Offshore and Energy', slug: 'offshore-and-energy', description: null, icon: null, position: 100 })
    const audit = await db.query(`select actor_id, metadata from public.audit_events where target_id = $1 and action = 'community.category_renamed'`, [created.id])
    expect(audit[0]).toMatchObject({ actor_id: adminId, metadata: { previous: { name: 'Offshore & Energy' }, next: { name: 'Offshore and Energy' } } })
    expect(await auditActions()).toEqual(['community.category_created', 'community.category_renamed'])
  })

  it('reordering changes the order of the directory chips', async () => {
    const learning = (await categories().findBySlug('learning'))!
    const career = (await categories().findBySlug('career-advice'))!
    await newCommunity('Chief Mates Learning', learning.id)
    await newCommunity('Cadet Careers', career.id)
    const before = (await categories().listDirectoryChips()).map((chip) => chip.slug)
    expect(before.indexOf('career-advice')).toBeLessThan(before.indexOf('learning'))

    // Drag and drop sends the whole order: Learning first.
    const order = (await categories().listAll()).map((category) => category.id)
    await categories().reorder(adminId, [learning.id, ...order.filter((id) => id !== learning.id)])
    let chips = (await categories().listDirectoryChips()).map((chip) => chip.slug)
    expect(chips[0]).toBe('learning')
    expect(chips.indexOf('career-advice')).toBeGreaterThan(chips.indexOf('learning'))

    // The up and down buttons move one place: Career Advice sits fifth (after Learning and the first three).
    expect(chips.indexOf('career-advice')).toBe(4)
    for (let step = 0; step < 4; step += 1) await expect(categories().move(adminId, career.id, 'up')).resolves.toBe(true)
    chips = (await categories().listDirectoryChips()).map((chip) => chip.slug)
    expect(chips.slice(0, 2)).toEqual(['career-advice', 'learning'])
    await expect(categories().move(adminId, career.id, 'up')).resolves.toBe(false)
    await expect(categories().move(adminId, career.id, 'down')).resolves.toBe(true)
    expect((await categories().listDirectoryChips()).slice(0, 2).map((chip) => chip.slug)).toEqual(['learning', 'career-advice'])
    await expect(categories().reorder(adminId, [learning.id])).rejects.toBeInstanceOf(CommunityCategoryError)
    expect((await auditActions()).filter((action) => action === 'community.category_reordered')).toHaveLength(6)
  })

  it('never deletes a category in use; moving its communities first lets it go', async () => {
    const empty = await categories().create(adminId, { name: 'Empty For Now' })
    const used = await categories().create(adminId, { name: 'Bulk Carriers' })
    const target = (await categories().findBySlug('other'))!
    const created = await newCommunity('Capesize Crew', used.id)

    await expect(categories().remove(adminId, used.id)).rejects.toMatchObject({ code: 'category_in_use' })
    // The foreign key refuses too, even outside the app.
    await expect(db.query(`delete from public.community_categories where id = $1`, [used.id])).rejects.toThrow()
    await expect(categories().moveCommunities(adminId, used.id, used.id)).rejects.toMatchObject({ code: 'category_move_target_invalid' })

    await expect(categories().moveCommunities(adminId, used.id, target.id)).resolves.toBe(1)
    await expect(communities().getById(memberId, created.id)).resolves.toMatchObject({ category: { slug: 'other' } })
    await categories().remove(adminId, used.id)
    await categories().remove(adminId, empty.id)
    expect((await categories().listAll()).map((category) => category.name)).not.toContain('Bulk Carriers')
    const actions = await auditActions()
    expect(actions.slice(-3)).toEqual(['community.category_communities_moved', 'community.category_deleted', 'community.category_deleted'])
  })

  it('a hidden category leaves the picker, chips and facet, but stays on the communities that have it', async () => {
    const hidden = await categories().create(adminId, { name: 'Ro-Ro and Car Carriers' })
    const created = await newCommunity('PCTC Officers', hidden.id)
    await categories().setHidden(adminId, hidden.id, true)

    expect((await categories().listPickerOptions()).map((option) => option.id)).not.toContain(hidden.id)
    expect((await categories().listDirectoryChips()).map((chip) => chip.id)).not.toContain(hidden.id)
    expect((await communities().countSearchGroupsByCategory('PCTC')).map((chip) => chip.id)).not.toContain(hidden.id)
    // Still on its community, shown as hidden.
    await expect(communities().getById(memberId, created.id)).resolves.toMatchObject({ category: { id: hidden.id, hidden: true } })

    // A new community cannot take it; the community that has it keeps it when it is saved.
    await expect(newCommunity('Another PCTC Group', hidden.id)).rejects.toMatchObject({ code: 'group_category_unavailable' })
    await communities().updateGroup(created.id, { name: 'PCTC Officers', description: 'Edited', rules: '', visibility: 'public', icon: null, categoryId: hidden.id })
    await expect(communities().getById(memberId, created.id)).resolves.toMatchObject({ description: 'Edited', category: { id: hidden.id } })

    await categories().setHidden(adminId, hidden.id, false)
    expect((await categories().listPickerOptions()).map((option) => option.id)).toContain(hidden.id)
    expect((await auditActions()).slice(-2)).toEqual(['community.category_hidden', 'community.category_shown'])
  })

  it('keeps the old category column in step for the old values only', async () => {
    const learning = (await categories().findBySlug('learning'))!
    const custom = await categories().create(adminId, { name: 'Tug and Towage' })
    const a = await newCommunity('Learning Crew Two', learning.id)
    const b = await newCommunity('Tug Masters', custom.id)
    const rows = await db.query(`select id, category from public.community_groups where id = any($1::uuid[])`, [[a.id, b.id]])
    expect(Object.fromEntries(rows.map((row) => [row.id, row.category]))).toEqual({ [a.id]: 'learning', [b.id]: null })
    // The old filter value still finds the category.
    await expect(categories().findBySlug('maritime_news')).resolves.toMatchObject({ slug: 'maritime-news' })
  })
})

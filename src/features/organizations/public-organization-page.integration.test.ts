import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createOrganizationWorkspaceRepository } from './workspace-repository'

/**
 * Round ARCH (Phase 2) against the real schema (PGlite, every migration): which organizations have a public
 * page and reach the sitemap. Claimed and listed to members: yes. Unclaimed (imported), pending, awaiting
 * changes, suspended, rejected and deleted: no. Placeholder data only.
 */
let db: TestDatabase
let sequence = 0
const query = (text: string, values?: readonly unknown[]) => db.query(text, values)
const repository = () => createOrganizationWorkspaceRepository({ query })

let owner = ''

async function company(input: { verified?: boolean; claim?: 'claimed' | 'unclaimed'; application?: 'pending' | 'changes_requested' | 'approved' | 'rejected' | 'suspended' }) {
  sequence += 1
  const slug = `placeholder-public-org-${sequence}`
  const [row] = await db.query(
    `insert into public.companies (slug, name, created_by, is_verified, claim_status) values ($1, $2, $3, $4, $5) returning id`,
    [slug, `Placeholder Public Org ${sequence}`, owner, input.verified ?? false, input.claim ?? 'claimed'],
  )
  const id = String(row!.id)
  if (input.application) {
    await db.query(
      `insert into public.organization_applications (company_id, submitted_by, status, official_email, applicant_role)
       values ($1, $2, $3, $4, 'Owner')`,
      [id, owner, input.application, `owner${sequence}@placeholder.example`],
    )
  }
  return { id, slug }
}

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
  const [row] = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), 'Placeholder Owner') returning id`)
  owner = String(row!.id)
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('public organization pages (Round ARCH, Phase 2)', () => {
  it('shows a verified (approved) organization and a claimed page that never needed an application', async () => {
    const approved = await company({ verified: true, application: 'approved' })
    const legacy = await company({ verified: false })
    expect((await repository().getPublicBySlug(approved.slug))?.id).toBe(approved.id)
    expect((await repository().getPublicBySlug(legacy.slug))?.id).toBe(legacy.id)
  })

  it.each([
    ['an unclaimed (imported) page', { claim: 'unclaimed' as const }],
    ['a pending application', { application: 'pending' as const }],
    ['an application awaiting changes', { application: 'changes_requested' as const }],
    ['a rejected (removed) organization', { application: 'rejected' as const }],
  ])('hides %s from visitors, while members can still open it', async (_case, input) => {
    const hidden = await company(input)
    expect(await repository().getPublicBySlug(hidden.slug)).toBeNull()
    expect((await repository().getBySlug(hidden.slug))?.id).toBe(hidden.id)
  })

  it('hides an organization the moment Sea N Shore suspends it', async () => {
    const organization = await company({ verified: true, application: 'approved' })
    expect(await repository().getPublicBySlug(organization.slug)).not.toBeNull()
    await db.query(`update public.organization_applications set status = 'suspended' where company_id = $1`, [organization.id])
    expect(await repository().getPublicBySlug(organization.slug)).toBeNull()
  })

  it('hides a deleted organization', async () => {
    const organization = await company({ verified: true, application: 'approved' })
    await db.query(`delete from public.companies where id = $1`, [organization.id])
    expect(await repository().getPublicBySlug(organization.slug)).toBeNull()
  })

  it('lists only public organizations in the sitemap', async () => {
    const shown = await company({ verified: true, application: 'approved' })
    const unclaimed = await company({ claim: 'unclaimed' })
    const suspended = await company({ verified: true, application: 'suspended' })
    const rejected = await company({ application: 'rejected' })
    const slugs = (await repository().listPublicSitemapOrganizations(50_000)).map((entry) => entry.slug)
    expect(slugs).toContain(shown.slug)
    expect(slugs).not.toContain(unclaimed.slug)
    expect(slugs).not.toContain(suspended.slug)
    expect(slugs).not.toContain(rejected.slug)
  })

  it('counts followers without a viewer and finds a slug by id', async () => {
    const organization = await company({ verified: true, application: 'approved' })
    await db.query(`insert into public.organization_follows (company_id, follower_id) values ($1, $2)`, [organization.id, owner])
    await expect(repository().countFollowers(organization.id)).resolves.toBe(1)
    await expect(repository().getSlugById(organization.id)).resolves.toBe(organization.slug)
    await expect(repository().getSlugById('00000000-0000-4000-8000-000000000000')).resolves.toBeNull()
  })
})

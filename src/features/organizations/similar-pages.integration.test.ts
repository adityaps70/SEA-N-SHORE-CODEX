import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createOrganizationWorkspaceRepository } from './workspace-repository'

/**
 * "Similar pages" on an organization page (round G, G5) runs on the real schema (PGlite). Production logged
 * Postgres 42702 (ambiguous column "code") for this query while its unit test mocked the database.
 * Placeholder data only.
 */
let db: TestDatabase
let viewerId: string

async function profile(name: string) {
  const [row] = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [name])
  return String(row!.id)
}

async function company(slug: string, vesselTypes: string[], createdBy: string) {
  const [row] = await db.query(
    `insert into public.companies (slug, name, created_by, is_verified, organization_type, vessel_types)
     values ($1, $2, $3, true, 'ship_manager', $4::text[]) returning id`,
    [slug, `Placeholder ${slug}`, createdBy, vesselTypes],
  )
  return String(row!.id)
}

beforeAll(async () => {
  db = await createTestDatabase()
  viewerId = await profile('Placeholder Viewer')
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('similar organization pages', () => {
  it('lists pages of the same type, those sharing a vessel group first', async () => {
    const owner = await profile('Placeholder Owner')
    const current = await company('placeholder-current', ['Oil Tanker'], owner)
    const sameGroup = await company('placeholder-same-group', ['Chemical Tanker'], owner)
    const otherGroup = await company('placeholder-other-group', ['LNG Carrier'], owner)
    const repository = createOrganizationWorkspaceRepository({ query: (text, values) => db.query(text, values) })

    const pages = await repository.listSimilarPagesByType({ id: current, organizationType: 'ship_manager', companyType: null }, viewerId, 4)

    expect(pages.map((page) => page.id)).toEqual([sameGroup, otherGroup])
  })
})

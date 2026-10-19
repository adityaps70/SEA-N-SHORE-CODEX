import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import { createJobShareRepository } from './share-repository'
import { createJobShareService, FEED_SHARE_INTERVAL_DAYS, JobShareError } from './share-service'
import { defaultShareOptions } from './share-options'

/**
 * Round I (I1) against the real schema (PGlite, every migration including 0094): who may share a job (verified
 * recruiter, verified organization's hiring roles, platform admin; not another organization's member or an
 * unverified recruiter), the 7-day feed rule with exactly one post, closed jobs, the feed job card and the
 * applies counted from shares. Placeholder data only.
 */
let db: TestDatabase
let sequence = 0
const query = (text: string, values?: readonly unknown[]) => db.query(text, values)
const transaction = <T,>(work: (run: typeof query) => Promise<T>) => db.transaction((tx) => work(tx))
const repository = () => createJobShareRepository({ query, transaction })

async function profile(name: string, input: { recruiter?: 'approved' | 'pending'; admin?: boolean } = {}) {
  const [row] = await db.query(`insert into public.profiles (id, full_name) values (gen_random_uuid(), $1) returning id`, [name])
  const id = String(row!.id)
  if (input.recruiter) await db.query(`insert into public.feature_verifications (profile_id, verification_type, status) values ($1, 'recruiter', $2)`, [id, input.recruiter])
  if (input.admin) await db.query(`insert into public.user_roles (user_id, role) values ($1, 'administrator')`, [id])
  return id
}

async function company(createdBy: string, verified: boolean) {
  sequence += 1
  const [row] = await db.query(
    `insert into public.companies (slug, name, created_by, is_verified) values ($1, $2, $3, $4) returning id`,
    [`placeholder-share-org-${sequence}`, `Placeholder Share Org ${sequence}`, createdBy, verified],
  )
  return String(row!.id)
}

async function member(companyId: string, userId: string, role: string) {
  await db.query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, $3, now())`, [companyId, userId, role])
}

async function job(input: { createdBy: string; companyId?: string | null; status?: string; applyUntil?: string | null }) {
  const [row] = await db.query(
    `insert into public.jobs (title, company_name, company_id, summary, description, created_by_user_id, status, published_at, apply_until, location)
     values ('Placeholder Chief Officer', 'Placeholder Company', $1, 'Placeholder summary.', 'Placeholder description.', $2, $3, now(), $4, 'Placeholder Port')
     returning id`,
    [input.companyId ?? null, input.createdBy, input.status ?? 'published', input.applyUntil ?? null],
  )
  return String(row!.id)
}

function service(admins: readonly string[] = []) {
  const posts: Array<{ actorId: string; id: string; companyId?: string; body: string }> = []
  const stored: string[] = []
  const shares = createJobShareService({
    repository: repository(),
    isPlatformAdmin: async (id) => admins.includes(id),
    loadSettings: async () => ({ socials: { instagram: '', linkedin: '', facebook: '', x: '', youtube: '' }, partners: [] }),
    siteUrl: () => 'https://seanshore.in',
    // The PNG itself is covered by share-image.test; here a placeholder buffer keeps the test fast.
    render: async ({ content }) => ({ png: Buffer.from('png'), layout: { fits: true, content } as never }),
    loadMedia: async () => null,
    putMedia: async ({ key }) => {
      stored.push(key)
    },
    createPost: async (actorId, post) => {
      await db.query(`insert into public.posts (id, author_id, category, body, audience) values ($1, $2, $3, $4, $5)`, [post.id, actorId, post.category, post.body, post.audience])
      posts.push({ actorId, id: post.id, companyId: post.companyId, body: post.body })
      return post.id
    },
  })
  return { shares, posts, stored }
}

const feedRequest = (jobId = 'x') => ({ options: defaultShareOptions({ urgent: false }), caption: `Placeholder caption https://seanshore.in/jobs/${jobId}?src=share_image` })

let ids: Record<string, string>

beforeAll(async () => {
  db = await createTestDatabase()
  await db.query(`alter table public.profiles drop constraint if exists profiles_completed_identity_check`)
  const verifiedRecruiter = await profile('Placeholder Verified Recruiter', { recruiter: 'approved' })
  const unverifiedRecruiter = await profile('Placeholder Unverified Recruiter', { recruiter: 'pending' })
  const orgOwner = await profile('Placeholder Org Owner')
  const orgRecruiter = await profile('Placeholder Org Recruiter')
  const orgViewer = await profile('Placeholder Org Viewer')
  const otherOrgAdmin = await profile('Placeholder Other Org Admin')
  const unverifiedOrgOwner = await profile('Placeholder Unverified Org Owner')
  const admin = await profile('Placeholder Platform Admin', { admin: true })
  const verifiedOrg = await company(orgOwner, true)
  const otherOrg = await company(otherOrgAdmin, true)
  const unverifiedOrg = await company(unverifiedOrgOwner, false)
  await member(verifiedOrg, orgOwner, 'owner')
  await member(verifiedOrg, orgRecruiter, 'recruiter')
  await member(verifiedOrg, orgViewer, 'member')
  await member(otherOrg, otherOrgAdmin, 'administrator')
  await member(unverifiedOrg, unverifiedOrgOwner, 'owner')
  ids = {
    verifiedRecruiter, unverifiedRecruiter, orgOwner, orgRecruiter, orgViewer, otherOrgAdmin, unverifiedOrgOwner, admin,
    personalJob: await job({ createdBy: verifiedRecruiter }),
    unverifiedPersonalJob: await job({ createdBy: unverifiedRecruiter }),
    orgJob: await job({ createdBy: orgRecruiter, companyId: verifiedOrg }),
    unverifiedOrgJob: await job({ createdBy: unverifiedOrgOwner, companyId: unverifiedOrg }),
    closedJob: await job({ createdBy: verifiedRecruiter, applyUntil: '2020-01-01' }),
    draftJob: await job({ createdBy: verifiedRecruiter, status: 'draft' }),
  }
}, 120_000)

afterAll(async () => {
  await db?.close()
})

describe('who may share a job', () => {
  it('lets a verified recruiter share their own personal job, and the hiring roles of a verified organization share its jobs', async () => {
    const { shares } = service()
    expect(await shares.access(ids.verifiedRecruiter!, ids.personalJob!)).toMatchObject({ asOrg: false, canPostToFeed: true, isPlatformAdmin: false })
    expect(await shares.access(ids.orgOwner!, ids.orgJob!)).toMatchObject({ asOrg: true, canPostToFeed: true })
    expect(await shares.access(ids.orgRecruiter!, ids.orgJob!)).toMatchObject({ asOrg: true, canPostToFeed: true })
  })

  it('refuses another organization’s admin, a plain member, an unverified recruiter and an unverified organization', async () => {
    const { shares } = service()
    expect(await shares.access(ids.otherOrgAdmin!, ids.orgJob!)).toBeNull()
    expect(await shares.access(ids.orgViewer!, ids.orgJob!)).toBeNull()
    expect(await shares.access(ids.unverifiedRecruiter!, ids.unverifiedPersonalJob!)).toBeNull()
    expect(await shares.access(ids.unverifiedOrgOwner!, ids.unverifiedOrgJob!)).toBeNull()
    expect(await shares.access(ids.verifiedRecruiter!, ids.orgJob!)).toBeNull()
    await expect(shares.panelState(ids.otherOrgAdmin!, ids.orgJob!)).rejects.toMatchObject({ code: 'job_share_forbidden' })
    await expect(shares.renderForViewer(ids.unverifiedRecruiter!, ids.unverifiedPersonalJob!, new URLSearchParams())).rejects.toBeInstanceOf(JobShareError)
  })

  it('lets a platform admin make the image of any job, but post only jobs that are theirs to post', async () => {
    const { shares } = service([ids.admin!])
    expect(await shares.access(ids.admin!, ids.unverifiedOrgJob!)).toMatchObject({ isPlatformAdmin: true, asOrg: true })
    expect(await shares.access(ids.admin!, ids.personalJob!)).toMatchObject({ isPlatformAdmin: true, canPostToFeed: false })
    await expect(shares.postToFeed(ids.admin!, ids.personalJob!, feedRequest())).rejects.toMatchObject({ code: 'job_share_forbidden' })
  })

  it('refuses closed and draft jobs, and lists only live shareable jobs for the hiring list', async () => {
    const { shares } = service()
    await expect(shares.panelState(ids.verifiedRecruiter!, ids.closedJob!)).rejects.toMatchObject({ code: 'job_share_closed' })
    await expect(shares.postToFeed(ids.verifiedRecruiter!, ids.closedJob!, feedRequest())).rejects.toMatchObject({ code: 'job_share_closed' })
    expect(await shares.canShare(ids.verifiedRecruiter!, ids.draftJob!)).toBe(false)
    expect(await shares.canShare(ids.verifiedRecruiter!, ids.personalJob!)).toBe(true)
    const listed = await shares.shareableJobIds(ids.verifiedRecruiter!, [ids.personalJob!, ids.closedJob!, ids.orgJob!].map((id) => ({ id, live: true })))
    expect([...listed]).toEqual([ids.personalJob])
  })
})

describe('Share to feed', () => {
  it('creates exactly one post, as the organization for an organization job, and refuses a second share for 7 days', async () => {
    const { shares, posts, stored } = service()
    const first = await shares.postToFeed(ids.orgRecruiter!, ids.orgJob!, feedRequest(ids.orgJob))
    expect(posts).toHaveLength(1)
    expect(posts[0]).toMatchObject({ id: first.postId, actorId: ids.orgRecruiter, companyId: expect.any(String) })
    // The caption's link counts applies from the feed post as feed_share.
    expect(posts[0]!.body).toContain(`/jobs/${ids.orgJob}?src=feed_share`)
    expect(posts[0]!.body).not.toContain('src=share_image')
    expect(stored[0]).toMatch(new RegExp(`^${ids.orgRecruiter}/${first.postId}/[0-9a-f-]+\\.png$`))

    // Another hiring role of the same organization is held to the same job's 7 days.
    const again = await shares.postToFeed(ids.orgOwner!, ids.orgJob!, feedRequest()).catch((error: unknown) => error)
    expect(again).toBeInstanceOf(JobShareError)
    expect((again as JobShareError).code).toBe('job_share_too_soon')
    const lastAt = (await db.query(`select created_at from public.job_shares where job_id = $1 and channel = 'feed'`, [ids.orgJob]))[0]!.created_at as Date
    expect((again as JobShareError).nextAt).toBe(new Date(new Date(lastAt).getTime() + FEED_SHARE_INTERVAL_DAYS * 86_400_000).toISOString())
    expect(posts).toHaveLength(1)
    await expect(db.query(`select count(*)::int as n from public.job_shares where job_id = $1 and channel = 'feed'`, [ids.orgJob])).resolves.toEqual([{ n: 1 }])

    const panel = await shares.panelState(ids.orgOwner!, ids.orgJob!)
    expect(panel.lastFeedShareAt).not.toBeNull()
    expect(panel.nextFeedShareAt).not.toBeNull()
    expect(panel.counts.feedPosts).toBe(1)

    // 8 days later it can be shared again.
    await db.query(`update public.job_shares set created_at = now() - interval '8 days' where job_id = $1`, [ids.orgJob])
    await shares.postToFeed(ids.orgOwner!, ids.orgJob!, feedRequest())
    expect(posts).toHaveLength(2)
  })

  it('never lets two requests at once both post', async () => {
    const { shares, posts } = service()
    const results = await Promise.allSettled([
      shares.postToFeed(ids.verifiedRecruiter!, ids.personalJob!, feedRequest()),
      shares.postToFeed(ids.verifiedRecruiter!, ids.personalJob!, feedRequest()),
    ])
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(posts).toHaveLength(1)
  })

  it('takes the reservation back when the post fails (for example the post rate limit), so it does not block 7 days', async () => {
    const newJob = await job({ createdBy: ids.verifiedRecruiter! })
    const failing = createJobShareService({
      ...{
        repository: repository(),
        isPlatformAdmin: async () => false,
        loadSettings: async () => ({ socials: { instagram: '', linkedin: '', facebook: '', x: '', youtube: '' }, partners: [] }),
        siteUrl: () => 'https://seanshore.in',
        render: async () => ({ png: Buffer.from('png'), layout: {} as never }),
        loadMedia: async () => null,
        putMedia: async () => undefined,
      },
      createPost: async () => {
        throw new Error('feed_post_rate_limited')
      },
    })
    await expect(failing.postToFeed(ids.verifiedRecruiter!, newJob, feedRequest())).rejects.toThrow('feed_post_rate_limited')
    await expect(db.query(`select count(*)::int as n from public.job_shares where job_id = $1`, [newJob])).resolves.toEqual([{ n: 0 }])
  })

  it('shows the job card on the post, and "closed" once the job closes', async () => {
    const { shares } = service()
    const newJob = await job({ createdBy: ids.verifiedRecruiter! })
    const { postId } = await shares.postToFeed(ids.verifiedRecruiter!, newJob, feedRequest())
    expect((await repository().listFeedJobCards([postId])).get(postId)).toMatchObject({ jobId: newJob, title: 'Placeholder Chief Officer', open: true })
    await db.query(`update public.jobs set status = 'closed' where id = $1`, [newJob])
    expect((await repository().listFeedJobCards([postId])).get(postId)).toMatchObject({ jobId: newJob, open: false })
  })
})

describe('og:image', () => {
  it('exists only for public, open jobs', async () => {
    const { shares } = service()
    expect(await shares.renderOpenGraph(ids.personalJob!)).not.toBeNull()
    expect(await shares.renderOpenGraph(ids.closedJob!)).toBeNull()
    expect(await shares.renderOpenGraph(ids.draftJob!)).toBeNull()
    const removed = await job({ createdBy: ids.verifiedRecruiter! })
    await db.query(`update public.jobs set deleted_at = now() where id = $1`, [removed])
    expect(await shares.renderOpenGraph(removed)).toBeNull()
  })
})

describe('share counts', () => {
  it('counts image shares and the applies that came from the image and the feed', async () => {
    const { shares } = service()
    const counted = await job({ createdBy: ids.verifiedRecruiter! })
    await shares.recordImageShare(ids.verifiedRecruiter!, counted)
    await shares.recordImageShare(ids.verifiedRecruiter!, counted)
    const applicants = await Promise.all(['A', 'B', 'C'].map((letter) => profile(`Placeholder Applicant ${letter}`)))
    const sources = ['share_image', 'feed_share', 'job_page']
    for (const [index, applicant] of applicants.entries()) {
      await db.query(`insert into public.job_applications (job_id, applicant_id, status, source) values ($1, $2, 'applied', $3)`, [counted, applicant, sources[index]])
    }
    expect((await shares.panelState(ids.verifiedRecruiter!, counted)).counts).toEqual({ images: 2, feedPosts: 0, appliesFromImage: 1, appliesFromFeed: 1 })
  })
})

import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { QueryResultRow } from 'pg'
import { createTestDatabase, type TestDatabase } from '@/lib/db/test-database'
import * as fixtures from './learning-test-fixtures'

/**
 * Hotfix S1: SCORM processing uses the same access rule as every other curriculum action. An
 * organization's owner, administrator or LMS manager can process a SCORM ZIP on the organization's
 * course and on a draft copy of its published course; a member of another organization cannot;
 * a trainer's personal course works as before. Real schema (PGlite); storage is faked. Placeholder data only.
 */
let db: TestDatabase
const stored = new Map<string, Uint8Array>()
const written: string[] = []
let currentUser = ''

vi.mock('@/lib/db/client', () => ({
  query: (text: string, values?: readonly unknown[]) => db.query(text, values),
  withTransaction: <T,>(work: (client: { query: (text: string, values?: readonly unknown[]) => Promise<{ rows: QueryResultRow[] }> }) => Promise<T>) =>
    db.transaction((query) => work({ query: async (text, values) => ({ rows: await query(text, values) }) })),
}))
vi.mock('@/lib/aws/storage', () => ({
  headMediaObject: async (key: string) => {
    const body = stored.get(key)
    if (!body) throw new Error('missing')
    return { contentType: 'application/zip', contentLength: body.byteLength }
  },
  getMediaObject: async ({ key }: { key: string }) => ({ body: stored.get(key)!, contentType: 'application/zip' }),
  putMediaObject: async ({ key }: { key: string }) => { written.push(key) },
  deleteMediaObject: async () => {},
  createMediaReadUrl: async (key: string) => `https://media.invalid/${key}`,
  createMediaUploadUrl: async () => ({ url: 'https://media.invalid/upload', fields: {} }),
}))
vi.mock('next/cache', () => ({ revalidatePath: () => {} }))
vi.mock('@/features/auth/aws-queries', () => ({ requireAwsUser: async () => ({ id: currentUser }) }))

const { processScormPackageForMentor } = await import('./scorm-authoring')
const { processCurriculumScormPackage } = await import('./scorm-authoring-actions')

function storedZip(entries: Array<{ name: string; body: string }>) {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const body = Buffer.from(entry.body)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(body.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, body)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(body.length, 20)
    central.writeUInt32LE(body.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + body.length
  }
  const centralBytes = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralBytes.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralBytes, eocd])
}

const SCORM_12 = storedZip([
  {
    name: 'imsmanifest.xml',
    body: `<?xml version="1.0"?>
      <manifest identifier="fixture" version="1.0">
        <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
        <organizations default="ORG"><organization identifier="ORG"><item identifier="ITEM" identifierref="RES"/></organization></organizations>
        <resources><resource identifier="RES" type="webcontent" adlcp:scormtype="sco" href="index.html"/></resources>
      </manifest>`,
  },
  { name: 'index.html', body: '<html><body>Placeholder lesson</body></html>' },
])

/** Uploads a ZIP the way createLearningMediaUpload names it: learning/<uploader>/<course>/scorm_package/<uuid>.zip */
function upload(uploaderId: string, courseId: string) {
  const key = `learning/${uploaderId}/${courseId}/scorm_package/${randomUUID()}.zip`
  stored.set(key, SCORM_12)
  return key
}

let sequence = 0

async function organization(role = 'administrator') {
  sequence += 1
  const adminId = await fixtures.createProfile(db.query, `Placeholder Org Admin ${sequence}`)
  const [company] = await db.query(
    `insert into public.companies (slug, name, created_by, is_verified) values ($1, $2, $3, true) returning id`,
    [`placeholder-org-${sequence}`, `Placeholder Org ${sequence}`, adminId],
  )
  await db.query(
    `insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, $3, now())`,
    [company!.id, adminId, role],
  )
  return { companyId: String(company!.id), adminId }
}

async function addMember(companyId: string, role: string) {
  sequence += 1
  const id = await fixtures.createProfile(db.query, `Placeholder Member ${sequence}`)
  await db.query(`insert into public.company_members (company_id, user_id, role, approved_at) values ($1, $2, $3, now())`, [companyId, id, role])
  return id
}

async function course(input: { companyId?: string; mentorId?: string; createdBy: string; status: string; revisionOf?: string }) {
  sequence += 1
  const [row] = await db.query(
    `insert into public.learning_courses (
       mentor_id, company_id, created_by_user_id, slug, title, description, category, level, access_type, price_minor,
       currency, certificate_enabled, status, revision_of_course_id, published_at, approved_at
     ) values ($1, $2, $3, $4, 'Placeholder BCA course', 'A placeholder course used only by automated tests of SCORM processing.',
       'Safety', 'beginner', 'free', 0, 'INR', false, $5, $6,
       case when $5 = 'published' then now() end, case when $5 = 'published' then now() end)
     returning id`,
    [input.mentorId ?? null, input.companyId ?? null, input.createdBy, `placeholder-scorm-${sequence}`, input.status, input.revisionOf ?? null],
  )
  return String(row!.id)
}

async function scormLesson(courseId: string, assetPath: string | null) {
  const [section] = await db.query(
    `insert into public.learning_course_sections (course_id, title, position)
     values ($1, 'Section A', (select count(*) from public.learning_course_sections where course_id = $1)) returning id`,
    [courseId],
  )
  const [lesson] = await db.query(
    `insert into public.learning_lessons (section_id, position, title, lesson_type, completion_rule, asset_path)
     values ($1, 0, 'Placeholder SCORM', 'scorm', 'scorm_completion', $2) returning id`,
    [section!.id, assetPath],
  )
  return String(lesson!.id)
}

async function packageStatus(lessonId: string) {
  const rows = await db.query(`select status, scorm_version, launch_path from public.learning_scorm_packages where lesson_id = $1`, [lessonId])
  return rows[0] ?? null
}

beforeAll(async () => {
  db = await createTestDatabase()
}, 120_000)

afterAll(async () => {
  await db?.close()
})

beforeEach(() => {
  written.length = 0
})

describe('SCORM processing access (hotfix S1)', () => {
  it('lets an organization administrator process a ZIP on the organization’s course', async () => {
    const org = await organization('administrator')
    const courseId = await course({ companyId: org.companyId, createdBy: org.adminId, status: 'draft' })
    const zip = upload(org.adminId, courseId)
    const lessonId = await scormLesson(courseId, zip)

    const result = await processScormPackageForMentor({ actorId: org.adminId, courseId, lessonId, sourceZipPath: zip })

    expect(result).toMatchObject({ version: '1.2', launchPath: 'index.html' })
    expect(await packageStatus(lessonId)).toEqual({ status: 'ready', scorm_version: '1.2', launch_path: 'index.html' })
    expect(written.some((key) => key.endsWith('/index.html'))).toBe(true)
  })

  it('lets an LMS manager process a ZIP on a draft copy of the organization’s published course, including a ZIP carried over from the published course', async () => {
    const org = await organization('owner')
    const manager = await addMember(org.companyId, 'lms_manager')
    const published = await course({ companyId: org.companyId, createdBy: org.adminId, status: 'published' })
    const draftCopy = await course({ companyId: org.companyId, createdBy: org.adminId, status: 'draft', revisionOf: published })

    const fresh = upload(manager, draftCopy)
    const freshLesson = await scormLesson(draftCopy, fresh)
    await expect(processScormPackageForMentor({ actorId: manager, courseId: draftCopy, lessonId: freshLesson, sourceZipPath: fresh }))
      .resolves.toMatchObject({ version: '1.2' })

    // The copy's material still points at the ZIP the owner uploaded for the published course.
    const carried = upload(org.adminId, published)
    const carriedLesson = await scormLesson(draftCopy, carried)
    await expect(processScormPackageForMentor({ actorId: manager, courseId: draftCopy, lessonId: carriedLesson, sourceZipPath: carried }))
      .resolves.toMatchObject({ version: '1.2' })
    expect(await packageStatus(carriedLesson)).toMatchObject({ status: 'ready' })
  })

  it('refuses a member of a different organization, with a permission error and no package written', async () => {
    const org = await organization('administrator')
    const other = await organization('administrator')
    const courseId = await course({ companyId: org.companyId, createdBy: org.adminId, status: 'draft' })
    const zip = upload(other.adminId, courseId)
    const lessonId = await scormLesson(courseId, zip)

    await expect(processScormPackageForMentor({ actorId: other.adminId, courseId, lessonId, sourceZipPath: zip }))
      .rejects.toThrow('scorm_forbidden')
    expect(await packageStatus(lessonId)).toBeNull()
    expect(written).toEqual([])
  })

  it('refuses an organization member without a course management role', async () => {
    const org = await organization('administrator')
    const recruiter = await addMember(org.companyId, 'recruiter')
    const courseId = await course({ companyId: org.companyId, createdBy: org.adminId, status: 'draft' })
    const zip = upload(recruiter, courseId)
    const lessonId = await scormLesson(courseId, zip)

    await expect(processScormPackageForMentor({ actorId: recruiter, courseId, lessonId, sourceZipPath: zip }))
      .rejects.toThrow('scorm_forbidden')
  })

  it('keeps the personal-course path: the course’s trainer can, another trainer cannot', async () => {
    const trainer = await fixtures.createActiveMentor(db.query)
    const stranger = await fixtures.createActiveMentor(db.query)
    const courseId = await course({ mentorId: trainer.mentorId, createdBy: trainer.userId, status: 'draft' })
    const zip = upload(trainer.userId, courseId)
    const lessonId = await scormLesson(courseId, zip)

    await expect(processScormPackageForMentor({ actorId: trainer.userId, courseId, lessonId, sourceZipPath: zip }))
      .resolves.toMatchObject({ version: '1.2' })
    await expect(processScormPackageForMentor({ actorId: stranger.userId, courseId, lessonId, sourceZipPath: zip }))
      .rejects.toThrow('scorm_forbidden')
  })

  it('still refuses a published course and a ZIP that is neither the uploader’s own nor attached to the material', async () => {
    const org = await organization('administrator')
    const published = await course({ companyId: org.companyId, createdBy: org.adminId, status: 'published' })
    const publishedZip = upload(org.adminId, published)
    const publishedLesson = await scormLesson(published, publishedZip)
    await expect(processScormPackageForMentor({ actorId: org.adminId, courseId: published, lessonId: publishedLesson, sourceZipPath: publishedZip }))
      .rejects.toThrow('course_edit_forbidden')

    const colleague = await addMember(org.companyId, 'lms_manager')
    const draft = await course({ companyId: org.companyId, createdBy: org.adminId, status: 'draft' })
    const lessonId = await scormLesson(draft, null)
    const someoneElses = upload(colleague, draft)
    await expect(processScormPackageForMentor({ actorId: org.adminId, courseId: draft, lessonId, sourceZipPath: someoneElses }))
      .rejects.toThrow('learning_media_reference_invalid')
  })

  it('tells the uploader plainly when they lack permission, instead of "could not find this material"', async () => {
    const org = await organization('administrator')
    const other = await organization('administrator')
    const courseId = await course({ companyId: org.companyId, createdBy: org.adminId, status: 'draft' })
    const zip = upload(other.adminId, courseId)
    const lessonId = await scormLesson(courseId, zip)

    currentUser = other.adminId
    const refused = await processCurriculumScormPackage(courseId, lessonId, zip)
    expect(refused).toEqual({ ok: false, error: expect.stringContaining('You do not have permission to edit this course’s materials') })

    currentUser = org.adminId
    const own = upload(org.adminId, courseId)
    await db.query(`update public.learning_lessons set asset_path = $2 where id = $1`, [lessonId, own])
    await expect(processCurriculumScormPackage(courseId, lessonId, own)).resolves.toEqual({ ok: true, version: '1.2', launchPath: 'index.html', fileCount: 2 })
  })
})

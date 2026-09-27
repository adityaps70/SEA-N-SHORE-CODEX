import { describe, expect, it, vi } from 'vitest'
import {
  buildProfileDocumentStoragePath,
  hasPdfSignature,
  isOwnedProfileDocumentStoragePath,
  MAX_PROFILE_DOCUMENT_BYTES,
  PROFILE_DOCUMENT_URL_TTL_SECONDS,
  validateProfileDocumentMetadata,
} from './profile-document-policy'
import type { ProfileDocumentOwner, ProfileDocumentRecord } from './profile-document-repository'

vi.mock('@/lib/aws/storage', () => ({
  createMediaReadUrl: vi.fn(),
  createMediaUploadUrl: vi.fn(),
  deleteMediaObject: vi.fn(),
  getMediaObject: vi.fn(),
  headMediaObject: vi.fn(),
}))
vi.mock('./profile-document-repository', () => ({ profileDocumentRepository: {} }))

import { canHoldDgProfile, createProfileDocumentService, DG_PROFILE_MESSAGES } from './profile-document-service'

const ownerId = '11111111-1111-4111-8111-111111111111'
const employerId = '22222222-2222-4222-8222-222222222222'
const strangerId = '33333333-3333-4333-8333-333333333333'
const adminId = '44444444-4444-4444-8444-444444444444'
const objectId = '55555555-5555-4555-8555-555555555555'
const storagePath = `profile-documents/${ownerId}/dg-profile/${objectId}.pdf`

const pdfBytes = new TextEncoder().encode('%PDF-1.7\n%âãÏÓ\n1 0 obj\n<<>>\nendobj\n%%EOF')

function record(overrides: Partial<ProfileDocumentRecord> = {}): ProfileDocumentRecord {
  return {
    kind: 'dg_profile',
    storagePath,
    fileName: 'DG profile.pdf',
    sizeBytes: pdfBytes.length,
    uploadedAt: '2026-09-20T10:00:00.000Z',
    ...overrides,
  }
}

function setup(options: {
  owner?: ProfileDocumentOwner | null
  document?: ProfileDocumentRecord | null
  access?: Record<string, { isAdmin: boolean; isEmployer: boolean }>
  stored?: { contentType: string | null; contentLength: number | null }
  body?: Uint8Array
  previousStoragePath?: string | null
} = {}) {
  const owner = options.owner === undefined
    ? { persona: 'seafarer' as const, profileType: 'seafarer', onboardingCompleted: true }
    : options.owner
  const repository = {
    getOwner: vi.fn(async () => owner),
    getDocument: vi.fn(async () => (options.document === undefined ? record() : options.document)),
    upsertDocument: vi.fn(async (_profileId: string, document: { storagePath: string; fileName: string; sizeBytes: number }) => ({
      document: record({ storagePath: document.storagePath, fileName: document.fileName, sizeBytes: document.sizeBytes }),
      previousStoragePath: options.previousStoragePath ?? null,
    })),
    deleteDocument: vi.fn(async () => storagePath),
    getViewerAccess: vi.fn(async (viewerId: string) => options.access?.[viewerId] ?? { isAdmin: false, isEmployer: false }),
  }
  const storage = {
    createUploadUrl: vi.fn(async () => 'https://bucket.example/upload?signature=abc'),
    head: vi.fn(async () => options.stored ?? { contentType: 'application/pdf', contentLength: pdfBytes.length }),
    read: vi.fn(async () => ({ body: options.body ?? pdfBytes })),
    remove: vi.fn(async () => undefined),
    createReadUrl: vi.fn(async (key: string, ttl: number) => `https://bucket.example/${key}?expires=${ttl}`),
  }
  const service = createProfileDocumentService({ repository, storage, newObjectId: () => objectId })
  return { service, repository, storage }
}

describe('DG profile document policy', () => {
  it('accepts PDFs up to 10 MB and rejects other types, names and sizes', () => {
    expect(validateProfileDocumentMetadata({ fileName: 'dg.pdf', mimeType: 'application/pdf', sizeBytes: 1024 }).ok).toBe(true)
    expect(validateProfileDocumentMetadata({ fileName: 'dg.pdf', mimeType: 'application/pdf', sizeBytes: MAX_PROFILE_DOCUMENT_BYTES }).ok).toBe(true)
    expect(validateProfileDocumentMetadata({ fileName: 'dg.pdf', mimeType: 'application/pdf', sizeBytes: MAX_PROFILE_DOCUMENT_BYTES + 1 }).ok).toBe(false)
    expect(validateProfileDocumentMetadata({ fileName: 'dg.pdf', mimeType: 'application/pdf', sizeBytes: 0 }).ok).toBe(false)
    expect(validateProfileDocumentMetadata({ fileName: 'dg.png', mimeType: 'application/pdf', sizeBytes: 10 }).ok).toBe(false)
    expect(validateProfileDocumentMetadata({ fileName: 'dg.pdf', mimeType: 'image/png', sizeBytes: 10 }).ok).toBe(false)
  })

  it('recognises the PDF signature and rejects renamed files', () => {
    expect(hasPdfSignature(pdfBytes)).toBe(true)
    expect(hasPdfSignature(new Uint8Array([0xef, 0xbb, 0xbf, ...pdfBytes]))).toBe(true)
    expect(hasPdfSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]))).toBe(false)
    expect(hasPdfSignature(new TextEncoder().encode('<html>%PDF-</html>'.padStart(2000, ' ')))).toBe(false)
    expect(hasPdfSignature(new Uint8Array())).toBe(false)
  })

  it('only accepts unguessable storage paths inside the owner’s own folder', () => {
    const path = buildProfileDocumentStoragePath(ownerId)
    expect(isOwnedProfileDocumentStoragePath(ownerId, path)).toBe(true)
    expect(isOwnedProfileDocumentStoragePath(strangerId, path)).toBe(false)
    expect(isOwnedProfileDocumentStoragePath(ownerId, `profile-documents/${ownerId}/dg-profile/../../x.pdf`)).toBe(false)
    expect(isOwnedProfileDocumentStoragePath(ownerId, `profile-documents/${ownerId}/dg-profile/cv.pdf`)).toBe(false)
  })

  it('lets seafarers and members still onboarding hold a DG profile, and nobody else', () => {
    expect(canHoldDgProfile({ persona: 'seafarer', profileType: 'seafarer', onboardingCompleted: true })).toBe(true)
    expect(canHoldDgProfile({ persona: null, profileType: 'seafarer', onboardingCompleted: true })).toBe(true)
    expect(canHoldDgProfile({ persona: null, profileType: null, onboardingCompleted: false })).toBe(true)
    expect(canHoldDgProfile({ persona: 'recruiter_hr', profileType: 'recruiter', onboardingCompleted: true })).toBe(false)
  })
})

describe('DG profile upload', () => {
  it('issues a presigned upload for an eligible seafarer in the private documents folder', async () => {
    const { service, storage } = setup()
    const result = await service.prepareDgProfileUpload(ownerId, { fileName: 'DG profile.pdf', mimeType: 'application/pdf', sizeBytes: 2048 })
    expect(result).toEqual({
      ok: true,
      uploadUrl: 'https://bucket.example/upload?signature=abc',
      storagePath,
      fileName: 'DG profile.pdf',
      sizeBytes: 2048,
    })
    expect(storage.createUploadUrl).toHaveBeenCalledWith({ key: storagePath, contentType: 'application/pdf' })
  })

  it('refuses non-seafarer profiles and non-PDF files before touching storage', async () => {
    const recruiter = setup({ owner: { persona: 'recruiter_hr', profileType: 'recruiter', onboardingCompleted: true } })
    await expect(recruiter.service.prepareDgProfileUpload(ownerId, { fileName: 'dg.pdf', mimeType: 'application/pdf', sizeBytes: 10 }))
      .resolves.toEqual({ ok: false, error: DG_PROFILE_MESSAGES.notEligible })
    expect(recruiter.storage.createUploadUrl).not.toHaveBeenCalled()

    const seafarer = setup()
    const wrongType = await seafarer.service.prepareDgProfileUpload(ownerId, { fileName: 'dg.docx', mimeType: 'application/msword', sizeBytes: 10 })
    expect(wrongType.ok).toBe(false)
    expect(seafarer.storage.createUploadUrl).not.toHaveBeenCalled()
  })

  it('saves a verified PDF and deletes the file it replaced', async () => {
    const previous = `profile-documents/${ownerId}/dg-profile/66666666-6666-4666-8666-666666666666.pdf`
    const { service, repository, storage } = setup({ previousStoragePath: previous })

    const result = await service.confirmDgProfileUpload(ownerId, { storagePath, fileName: 'DG profile.pdf', sizeBytes: pdfBytes.length })

    expect(result).toMatchObject({ ok: true, document: { kind: 'dg_profile', fileName: 'DG profile.pdf', sizeBytes: pdfBytes.length } })
    expect(result.ok && 'storagePath' in result.document).toBe(false)
    expect(repository.upsertDocument).toHaveBeenCalledWith(ownerId, expect.objectContaining({ kind: 'dg_profile', storagePath, mimeType: 'application/pdf' }))
    expect(storage.remove).toHaveBeenCalledWith(previous)
    expect(storage.remove).not.toHaveBeenCalledWith(storagePath)
  })

  it('rejects and deletes an upload whose bytes are not a PDF even if it was declared as one', async () => {
    const fake = new TextEncoder().encode('MZ this is an executable')
    const { service, repository, storage } = setup({ body: fake, stored: { contentType: 'application/pdf', contentLength: fake.length } })

    const result = await service.confirmDgProfileUpload(ownerId, { storagePath, fileName: 'dg.pdf', sizeBytes: fake.length })

    expect(result).toEqual({ ok: false, error: DG_PROFILE_MESSAGES.notPdf })
    expect(repository.upsertDocument).not.toHaveBeenCalled()
    expect(storage.remove).toHaveBeenCalledWith(storagePath)
  })

  it('rejects size mismatches and storage paths that belong to someone else', async () => {
    const mismatch = setup({ stored: { contentType: 'application/pdf', contentLength: 999 } })
    await expect(mismatch.service.confirmDgProfileUpload(ownerId, { storagePath, fileName: 'dg.pdf', sizeBytes: pdfBytes.length }))
      .resolves.toEqual({ ok: false, error: DG_PROFILE_MESSAGES.mismatch })
    expect(mismatch.repository.upsertDocument).not.toHaveBeenCalled()

    const foreign = setup()
    const otherPath = `profile-documents/${strangerId}/dg-profile/${objectId}.pdf`
    await expect(foreign.service.confirmDgProfileUpload(ownerId, { storagePath: otherPath, fileName: 'dg.pdf', sizeBytes: pdfBytes.length }))
      .resolves.toEqual({ ok: false, error: DG_PROFILE_MESSAGES.mismatch })
    expect(foreign.storage.head).not.toHaveBeenCalled()
    expect(foreign.storage.remove).not.toHaveBeenCalled()
  })

  it('removes the record and the stored file', async () => {
    const { service, repository, storage } = setup()
    await expect(service.removeDgProfile(ownerId)).resolves.toBe(true)
    expect(repository.deleteDocument).toHaveBeenCalledWith(ownerId, 'dg_profile')
    expect(storage.remove).toHaveBeenCalledWith(storagePath)
  })
})

describe('DG profile download authorisation', () => {
  const access = {
    [employerId]: { isAdmin: false, isEmployer: true },
    [adminId]: { isAdmin: true, isEmployer: false },
  }

  it.each([
    ['the owner', ownerId, 'owner'],
    ['an employer the seafarer applied to', employerId, 'employer'],
    ['a platform administrator', adminId, 'admin'],
  ])('gives %s a signed link that expires within a minute', async (_label, viewerId, reason) => {
    const { service, storage } = setup({ access })
    const download = await service.createDgProfileDownload(viewerId, ownerId)
    expect(download).toEqual({ status: 'ok', url: `https://bucket.example/${storagePath}?expires=${PROFILE_DOCUMENT_URL_TTL_SECONDS}`, reason })
    expect(PROFILE_DOCUMENT_URL_TTL_SECONDS).toBeLessThanOrEqual(60)
    expect(storage.createReadUrl).toHaveBeenCalledWith(storagePath, PROFILE_DOCUMENT_URL_TTL_SECONDS)
  })

  it.each([
    ['an employer without an application from this seafarer', { isAdmin: false, isEmployer: false }],
    ['a stranger', { isAdmin: false, isEmployer: false }],
  ])('refuses %s without revealing whether a document exists', async (_label, viewerAccess) => {
    const { service, storage, repository } = setup({ access: { [strangerId]: viewerAccess } })
    await expect(service.createDgProfileDownload(strangerId, ownerId)).resolves.toEqual({ status: 'unavailable' })
    expect(repository.getDocument).not.toHaveBeenCalled()
    expect(storage.createReadUrl).not.toHaveBeenCalled()
  })

  it('reports unavailable when an authorised viewer asks for a document that does not exist', async () => {
    const { service, storage } = setup({ document: null, access })
    await expect(service.createDgProfileDownload(employerId, ownerId)).resolves.toEqual({ status: 'unavailable' })
    expect(storage.createReadUrl).not.toHaveBeenCalled()
  })

  it('shows the document card only to viewers who may open it', async () => {
    const { service } = setup({ access })
    await expect(service.getViewableDgProfile(employerId, ownerId)).resolves.toMatchObject({ fileName: 'DG profile.pdf', reason: 'employer' })
    await expect(service.getViewableDgProfile(strangerId, ownerId)).resolves.toBeNull()
  })
})

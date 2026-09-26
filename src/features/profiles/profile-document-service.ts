import {
  createMediaReadUrl,
  createMediaUploadUrl,
  deleteMediaObject,
  getMediaObject,
  headMediaObject,
} from '@/lib/aws/storage'
import {
  buildProfileDocumentStoragePath,
  DG_PROFILE_DOCUMENT_KIND,
  hasPdfSignature,
  isOwnedProfileDocumentStoragePath,
  MAX_PROFILE_DOCUMENT_BYTES,
  PROFILE_DOCUMENT_MIME,
  PROFILE_DOCUMENT_URL_TTL_SECONDS,
  validateProfileDocumentMetadata,
  type ProfileDocumentSummary,
} from './profile-document-policy'
import {
  profileDocumentRepository,
  type ProfileDocumentOwner,
  type ProfileDocumentRecord,
  type ProfileDocumentRepository,
} from './profile-document-repository'

type DocumentStorage = {
  createUploadUrl: (input: { key: string; contentType: string }) => Promise<string>
  head: (key: string) => Promise<{ contentType: string | null; contentLength: number | null }>
  read: (input: { key: string; maxBytes: number }) => Promise<{ body: Uint8Array }>
  remove: (key: string) => Promise<void>
  createReadUrl: (key: string, expiresInSeconds: number) => Promise<string>
}

export type DgProfileUploadTicket = {
  uploadUrl: string
  storagePath: string
  fileName: string
  sizeBytes: number
}

export type DocumentResult<T> = ({ ok: true } & T) | { ok: false; error: string }

export type DgProfileAccessReason = 'owner' | 'admin' | 'employer'

export type DgProfileDownload =
  | { status: 'ok'; url: string; reason: DgProfileAccessReason }
  | { status: 'unavailable' }

export const DG_PROFILE_MESSAGES = {
  notEligible: 'Only seafarer profiles can add a DG Shipping profile. Choose Seafarer as your profile type first.',
  accountUnavailable: 'We could not find your active Sea N Shore account. Sign in again and retry.',
  prepareFailed: 'We could not start the upload. Check your connection and try again.',
  notUploaded: 'We could not find the uploaded file. Please choose the PDF again.',
  mismatch: 'We could not verify the uploaded file. Please choose the PDF again.',
  notPdf: 'That file is not a readable PDF. Download your DG profile PDF from the DG Shipping portal again and upload that file.',
  saveFailed: 'We could not save your DG profile. Please try again.',
  removeFailed: 'We could not remove your DG profile. Please try again.',
} as const

function normalizedMediaType(value: string | null) {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? null
}

function toSummary(record: ProfileDocumentRecord): ProfileDocumentSummary {
  return { kind: record.kind, fileName: record.fileName, sizeBytes: record.sizeBytes, uploadedAt: record.uploadedAt }
}

/** Seafarers, and members who have not finished onboarding yet (they pick the persona on the same screen). */
export function canHoldDgProfile(owner: ProfileDocumentOwner) {
  if (!owner.onboardingCompleted) return true
  if (owner.persona) return owner.persona === 'seafarer'
  return owner.profileType === 'seafarer'
}

export function createProfileDocumentService(input: {
  repository: Pick<ProfileDocumentRepository, 'getOwner' | 'getDocument' | 'upsertDocument' | 'deleteDocument' | 'getViewerAccess'>
  storage: DocumentStorage
  newObjectId?: () => string
}) {
  const { repository, storage } = input

  async function requireEligibleOwner(profileId: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const owner = await repository.getOwner(profileId)
    if (!owner) return { ok: false, error: DG_PROFILE_MESSAGES.accountUnavailable }
    if (!canHoldDgProfile(owner)) return { ok: false, error: DG_PROFILE_MESSAGES.notEligible }
    return { ok: true }
  }

  async function prepareDgProfileUpload(
    profileId: string,
    metadata: { fileName: string; mimeType: string; sizeBytes: number },
  ): Promise<DocumentResult<DgProfileUploadTicket>> {
    const validated = validateProfileDocumentMetadata(metadata)
    if (!validated.ok) return validated

    const eligible = await requireEligibleOwner(profileId)
    if (!eligible.ok) return eligible

    const storagePath = buildProfileDocumentStoragePath(profileId, input.newObjectId?.())
    try {
      const uploadUrl = await storage.createUploadUrl({ key: storagePath, contentType: PROFILE_DOCUMENT_MIME })
      return { ok: true, uploadUrl, storagePath, fileName: validated.fileName, sizeBytes: validated.sizeBytes }
    } catch {
      return { ok: false, error: DG_PROFILE_MESSAGES.prepareFailed }
    }
  }

  async function discard(storagePath: string) {
    await storage.remove(storagePath).catch(() => undefined)
  }

  async function confirmDgProfileUpload(
    profileId: string,
    reference: { storagePath: string; fileName: string; sizeBytes: number },
  ): Promise<DocumentResult<{ document: ProfileDocumentSummary }>> {
    const validated = validateProfileDocumentMetadata({ ...reference, mimeType: PROFILE_DOCUMENT_MIME })
    if (!validated.ok) return validated
    if (!isOwnedProfileDocumentStoragePath(profileId, reference.storagePath)) {
      return { ok: false, error: DG_PROFILE_MESSAGES.mismatch }
    }

    const eligible = await requireEligibleOwner(profileId)
    if (!eligible.ok) {
      await discard(reference.storagePath)
      return eligible
    }

    let stored: Awaited<ReturnType<DocumentStorage['head']>>
    try {
      stored = await storage.head(reference.storagePath)
    } catch {
      return { ok: false, error: DG_PROFILE_MESSAGES.notUploaded }
    }
    if (normalizedMediaType(stored.contentType) !== PROFILE_DOCUMENT_MIME || stored.contentLength !== validated.sizeBytes) {
      await discard(reference.storagePath)
      return { ok: false, error: DG_PROFILE_MESSAGES.mismatch }
    }

    // Never trust the browser's file type: the stored bytes must start like a PDF.
    let body: Uint8Array
    try {
      body = (await storage.read({ key: reference.storagePath, maxBytes: MAX_PROFILE_DOCUMENT_BYTES })).body
    } catch {
      await discard(reference.storagePath)
      return { ok: false, error: DG_PROFILE_MESSAGES.mismatch }
    }
    if (!hasPdfSignature(body)) {
      await discard(reference.storagePath)
      return { ok: false, error: DG_PROFILE_MESSAGES.notPdf }
    }

    try {
      const saved = await repository.upsertDocument(profileId, {
        kind: DG_PROFILE_DOCUMENT_KIND,
        storagePath: reference.storagePath,
        fileName: validated.fileName,
        mimeType: PROFILE_DOCUMENT_MIME,
        sizeBytes: validated.sizeBytes,
      })
      if (saved.previousStoragePath) await discard(saved.previousStoragePath)
      return { ok: true, document: toSummary(saved.document) }
    } catch {
      await discard(reference.storagePath)
      return { ok: false, error: DG_PROFILE_MESSAGES.saveFailed }
    }
  }

  async function removeDgProfile(profileId: string) {
    const storagePath = await repository.deleteDocument(profileId, DG_PROFILE_DOCUMENT_KIND)
    if (storagePath) await discard(storagePath)
    return Boolean(storagePath)
  }

  async function getOwnDgProfile(profileId: string): Promise<ProfileDocumentSummary | null> {
    const record = await repository.getDocument(profileId, DG_PROFILE_DOCUMENT_KIND)
    return record ? toSummary(record) : null
  }

  async function getAccessReason(viewerId: string, ownerId: string): Promise<DgProfileAccessReason | null> {
    if (viewerId === ownerId) return 'owner'
    const access = await repository.getViewerAccess(viewerId, ownerId)
    if (access.isAdmin) return 'admin'
    if (access.isEmployer) return 'employer'
    return null
  }

  /** The document a viewer other than the owner may open on a profile, or null. */
  async function getViewableDgProfile(
    viewerId: string,
    ownerId: string,
  ): Promise<(ProfileDocumentSummary & { reason: DgProfileAccessReason }) | null> {
    const reason = await getAccessReason(viewerId, ownerId)
    if (!reason) return null
    const summary = await getOwnDgProfile(ownerId)
    return summary ? { ...summary, reason } : null
  }

  /**
   * A signed link that expires in a minute. Missing and forbidden look the
   * same to the caller so strangers cannot learn whether a document exists.
   */
  async function createDgProfileDownload(viewerId: string, ownerId: string): Promise<DgProfileDownload> {
    const reason = await getAccessReason(viewerId, ownerId)
    if (!reason) return { status: 'unavailable' }
    const record = await repository.getDocument(ownerId, DG_PROFILE_DOCUMENT_KIND)
    if (!record) return { status: 'unavailable' }
    const url = await storage.createReadUrl(record.storagePath, PROFILE_DOCUMENT_URL_TTL_SECONDS)
    return { status: 'ok', url, reason }
  }

  return {
    prepareDgProfileUpload,
    confirmDgProfileUpload,
    removeDgProfile,
    getOwnDgProfile,
    getViewableDgProfile,
    createDgProfileDownload,
  }
}

const productionService = createProfileDocumentService({
  repository: profileDocumentRepository,
  storage: {
    createUploadUrl: (upload) => createMediaUploadUrl(upload),
    head: headMediaObject,
    read: getMediaObject,
    remove: deleteMediaObject,
    createReadUrl: createMediaReadUrl,
  },
})

export const prepareDgProfileUploadForProfile = productionService.prepareDgProfileUpload
export const confirmDgProfileUploadForProfile = productionService.confirmDgProfileUpload
export const removeDgProfileDocumentForProfile = productionService.removeDgProfile
export const getOwnDgProfileDocument = productionService.getOwnDgProfile
export const getViewableDgProfileDocument = productionService.getViewableDgProfile
export const createDgProfileDownloadForViewer = productionService.createDgProfileDownload

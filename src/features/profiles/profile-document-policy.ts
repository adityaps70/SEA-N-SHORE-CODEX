/**
 * Rules for private profile documents (today: the DG Shipping profile PDF a
 * seafarer can download from the DG Shipping e-governance portal). Shared by
 * the browser uploader and the server so both enforce the same limits.
 */
export const DG_PROFILE_DOCUMENT_KIND = 'dg_profile' as const
export const PROFILE_DOCUMENT_MIME = 'application/pdf' as const
export const MAX_PROFILE_DOCUMENT_BYTES = 10 * 1024 * 1024
/** Signed download links expire quickly; the authorised route issues a fresh one per click. */
export const PROFILE_DOCUMENT_URL_TTL_SECONDS = 60

export type ProfileDocumentKind = typeof DG_PROFILE_DOCUMENT_KIND

export type ProfileDocumentSummary = {
  kind: ProfileDocumentKind
  fileName: string
  sizeBytes: number
  uploadedAt: string
}

export const DG_PROFILE_EXPLANATION = 'The profile PDF you can download from the DG Shipping e-governance portal.'
export const DG_PROFILE_VISIBILITY = 'Private: only you, Sea N Shore admins, and employers whose jobs you apply to can open it.'

export const DG_PROFILE_FILE_ERROR = 'Choose your DG profile as a PDF file of 10 MB or less.'

export function validateProfileDocumentMetadata(input: {
  fileName: string
  mimeType: string
  sizeBytes: number
}): ({ ok: true; fileName: string; mimeType: typeof PROFILE_DOCUMENT_MIME; sizeBytes: number }) | { ok: false; error: string } {
  const fileName = input.fileName.trim().replace(/[\u0000-\u001f\u007f]/g, '')
  const mimeType = input.mimeType.trim().toLowerCase()
  if (!fileName || fileName.length > 255 || !fileName.toLowerCase().endsWith('.pdf')) {
    return { ok: false, error: DG_PROFILE_FILE_ERROR }
  }
  if (mimeType !== PROFILE_DOCUMENT_MIME) return { ok: false, error: DG_PROFILE_FILE_ERROR }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_PROFILE_DOCUMENT_BYTES) {
    return { ok: false, error: DG_PROFILE_FILE_ERROR }
  }
  return { ok: true, fileName, mimeType: PROFILE_DOCUMENT_MIME, sizeBytes: input.sizeBytes }
}

const UUID_PATTERN = '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}'

export function profileDocumentStoragePrefix(profileId: string) {
  return `profile-documents/${profileId}/dg-profile/`
}

export function buildProfileDocumentStoragePath(profileId: string, objectId: string = crypto.randomUUID()) {
  return `${profileDocumentStoragePrefix(profileId)}${objectId}.pdf`
}

/** Accepts only a path this member's own prepare step could have issued. */
export function isOwnedProfileDocumentStoragePath(profileId: string, storagePath: string) {
  const prefix = profileDocumentStoragePrefix(profileId)
  if (!storagePath.startsWith(prefix)) return false
  return new RegExp(`^${UUID_PATTERN}\\.pdf$`, 'i').test(storagePath.slice(prefix.length))
}

const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d] // "%PDF-"

/**
 * True when the bytes carry the PDF header. The PDF specification lets
 * readers accept the header anywhere in the first 1024 bytes.
 */
export function hasPdfSignature(bytes: Uint8Array) {
  const limit = Math.min(bytes.length - PDF_SIGNATURE.length, 1024 - PDF_SIGNATURE.length)
  for (let offset = 0; offset <= limit; offset += 1) {
    if (PDF_SIGNATURE.every((value, index) => bytes[offset + index] === value)) return true
  }
  return false
}

export function formatDocumentSize(bytes: number) {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    return `${Number.isInteger(mb) ? mb.toFixed(0) : mb.toFixed(1)} MB`
  }
  if (bytes >= 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${bytes} B`
}

export function dgProfileDownloadHref(profileId: string) {
  return `/api/profile/documents/dg-profile/${profileId}`
}

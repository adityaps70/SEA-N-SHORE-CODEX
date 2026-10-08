import {
  createMediaDownloadUrl,
  createMediaUploadUrl,
  deleteMediaObject,
  headMediaObject,
  readMediaObjectPrefix,
} from '@/lib/aws/storage'
import {
  matchesMessageAttachmentSignature,
  MESSAGE_ATTACHMENT_SIGNATURE_BYTES,
  messageAttachmentContentDisposition,
} from '@/features/messaging/media-policy'
import {
  buildAssignmentAttachmentPath,
  isAssignmentAttachmentPath,
  validateAssignmentAttachment,
  type AssignmentAttachmentRules,
} from './assignment-policy'
import type { VerifiedAssignmentAttachment } from './learner-assignment-repository'

/** Upload URLs live five minutes; download URLs (handed out per click by the route) five minutes too. */
export const ASSIGNMENT_ATTACHMENT_URL_SECONDS = 300

/**
 * A presigned upload for one file of a submission. The file goes to the private media bucket under
 * the submission's own prefix; nothing is recorded until the submission is checked and saved.
 */
export async function createPendingAssignmentUpload(input: {
  enrollmentId: string
  lessonId: string
  submissionId: string
  name: string
  mimeType: string
  size: number
  rules: AssignmentAttachmentRules
}) {
  const checked = validateAssignmentAttachment(input)
  if (!checked.ok) throw new AssignmentAttachmentError(checked.error)
  const storagePath = buildAssignmentAttachmentPath({
    enrollmentId: input.enrollmentId,
    lessonId: input.lessonId,
    submissionId: input.submissionId,
    extension: checked.extension,
  })
  const uploadUrl = await createMediaUploadUrl({ key: storagePath, contentType: checked.mimeType }, ASSIGNMENT_ATTACHMENT_URL_SECONDS)
  return { storagePath, uploadUrl, mimeType: checked.mimeType, name: checked.name }
}

/** A refusal with copy the learner can act on. */
export class AssignmentAttachmentError extends Error {
  constructor(readonly learnerMessage: string) {
    super('assignment_attachment_rejected')
    this.name = 'AssignmentAttachmentError'
  }
}

async function discardRejectedUpload(storagePath: string) {
  try {
    await deleteMediaObject(storagePath)
  } catch {
    // Best effort: an unrecorded object is never served (downloads go through recorded attachments only).
  }
}

/**
 * Checks an uploaded file before it is attached: it is under this submission's prefix, the stored
 * type and size match what was declared and the assignment allows, and its first bytes really are
 * that type. A file that fails is deleted.
 */
export async function verifyAssignmentUpload(input: {
  enrollmentId: string
  lessonId: string
  submissionId: string
  storagePath: string
  name: string
  mimeType: string
  size: number
  rules: AssignmentAttachmentRules
}): Promise<VerifiedAssignmentAttachment> {
  const checked = validateAssignmentAttachment(input)
  if (!checked.ok) throw new AssignmentAttachmentError(checked.error)
  if (!isAssignmentAttachmentPath({ ...input, extension: checked.extension })) {
    throw new AssignmentAttachmentError(`“${checked.name}” was not uploaded for this submission. Remove it and attach it again.`)
  }

  let stored: Awaited<ReturnType<typeof headMediaObject>>
  try {
    stored = await headMediaObject(input.storagePath)
  } catch {
    throw new AssignmentAttachmentError(`“${checked.name}” didn’t finish uploading. Remove it and attach it again.`)
  }
  const storedType = stored.contentType?.split(';', 1)[0]?.trim().toLowerCase() ?? null
  if (storedType !== checked.mimeType || stored.contentLength !== input.size) {
    await discardRejectedUpload(input.storagePath)
    throw new AssignmentAttachmentError(`“${checked.name}” doesn’t match what was uploaded. Remove it and attach it again.`)
  }

  let prefix: Uint8Array
  try {
    prefix = await readMediaObjectPrefix(input.storagePath, Math.min(MESSAGE_ATTACHMENT_SIGNATURE_BYTES, input.size))
  } catch {
    throw new AssignmentAttachmentError(`“${checked.name}” couldn’t be checked. Remove it and attach it again.`)
  }
  if (!matchesMessageAttachmentSignature(checked.mimeType, prefix)) {
    await discardRejectedUpload(input.storagePath)
    throw new AssignmentAttachmentError(`“${checked.name}” isn’t really a ${checked.extension.toUpperCase()} file. Attach the original file.`)
  }

  return { storagePath: input.storagePath, fileName: checked.name, contentType: checked.mimeType, sizeBytes: input.size }
}

/** A five-minute download URL that always serves the file as its checked type, as a download. */
export async function createAssignmentAttachmentDownloadUrl(input: { storagePath: string; fileName: string; contentType: string }) {
  return createMediaDownloadUrl({
    key: input.storagePath,
    contentType: input.contentType,
    contentDisposition: messageAttachmentContentDisposition({ name: input.fileName, disposition: 'attachment' }),
    expiresInSeconds: ASSIGNMENT_ATTACHMENT_URL_SECONDS,
  })
}

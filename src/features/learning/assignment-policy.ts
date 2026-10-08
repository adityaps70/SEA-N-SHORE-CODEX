/**
 * Assignment submissions: defaults for new assignments and the rules for files learners attach.
 * Pure (no database or storage), so the editor, the learner upload control and the server share it.
 */

/** Defaults for a new assignment. Existing assignments keep the limits they store. */
export const ASSIGNMENT_DEFAULTS = {
  maxUploadBytes: 20 * 1024 * 1024,
  maxFiles: 5,
  maxPoints: 100,
  passingPercentage: 70,
} as const

/** Hard ceilings, whatever an assignment is configured with (the database enforces the same). */
export const ASSIGNMENT_ATTACHMENT_LIMITS = {
  maxFiles: 10,
  maxUploadBytes: 100 * 1024 * 1024,
} as const

/** Supported attachment types and the file extensions each may carry. */
const ATTACHMENT_TYPES: Record<string, readonly string[]> = {
  'application/pdf': ['pdf'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/png': ['png'],
  'image/webp': ['webp'],
  'application/msword': ['doc'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'application/vnd.ms-excel': ['xls'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['xlsx'],
  'application/vnd.ms-powerpoint': ['ppt'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['pptx'],
  'application/zip': ['zip'],
  'text/plain': ['txt'],
  'text/csv': ['csv'],
}

/** Browsers name some types differently (Windows reports ZIP files as x-zip-compressed). */
const TYPE_ALIASES: Record<string, string> = {
  'application/x-zip-compressed': 'application/zip',
  'application/x-zip': 'application/zip',
  'image/jpg': 'image/jpeg',
}

const EXTENSION_TYPES: Record<string, string> = Object.fromEntries(
  Object.entries(ATTACHMENT_TYPES).flatMap(([type, extensions]) => extensions.map((extension) => [extension, type])),
)

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Storage root for learner submissions; nothing else is stored under it. */
export const ASSIGNMENT_ATTACHMENT_ROOT = 'learning-submissions'

export type AssignmentAttachmentRules = {
  acceptedExtensions: readonly string[]
  maxUploadBytes: number
  maxFiles: number
}

export type AssignmentAttachmentValidation =
  | { ok: true; mimeType: string; extension: string; name: string }
  | { ok: false; error: string }

function fileExtension(name: string) {
  const dot = name.lastIndexOf('.')
  if (dot <= 0 || dot === name.length - 1) return ''
  return name.slice(dot + 1).toLowerCase()
}

function safeDisplayName(name: string) {
  return name.replace(/[\u0000-\u001f\u007f/\\]/g, '').trim().slice(0, 255)
}

/** The canonical type for a reported type, or the type implied by the file name when none is reported. */
export function attachmentMimeType(input: { name: string; mimeType: string }) {
  const reported = input.mimeType.trim().toLowerCase().split(';')[0] ?? ''
  const normalized = TYPE_ALIASES[reported] ?? reported
  if (normalized && ATTACHMENT_TYPES[normalized]) return normalized
  if (!normalized || normalized === 'application/octet-stream') return EXTENSION_TYPES[fileExtension(input.name)] ?? normalized
  return normalized
}

function acceptedByAssignment(extension: string, accepted: readonly string[]) {
  if (accepted.length === 0) return true
  const allowed = new Set(accepted.map((item) => item.trim().toLowerCase().replace(/^\./, '')))
  if (allowed.has(extension)) return true
  // .jpg and .jpeg are the same file type.
  return (extension === 'jpg' && allowed.has('jpeg')) || (extension === 'jpeg' && allowed.has('jpg'))
}

export function attachmentRulesLabel(rules: Pick<AssignmentAttachmentRules, 'acceptedExtensions' | 'maxUploadBytes' | 'maxFiles'>) {
  const types = rules.acceptedExtensions.length > 0
    ? rules.acceptedExtensions.map((extension) => extension.replace(/^\./, '').toUpperCase()).join(', ')
    : 'PDF, Word, Excel, PowerPoint, images, text or ZIP'
  const megabytes = Math.max(1, Math.round(rules.maxUploadBytes / (1024 * 1024)))
  return `${types} · up to ${megabytes} MB each · up to ${rules.maxFiles} file${rules.maxFiles === 1 ? '' : 's'}`
}

/** The `accept` attribute for the learner's file picker. */
export function attachmentAccept(rules: Pick<AssignmentAttachmentRules, 'acceptedExtensions'>) {
  const extensions = rules.acceptedExtensions.length > 0
    ? rules.acceptedExtensions.map((extension) => extension.trim().toLowerCase().replace(/^\./, ''))
    : Object.keys(EXTENSION_TYPES)
  return extensions.filter((extension) => EXTENSION_TYPES[extension]).map((extension) => `.${extension}`).join(',')
}

/** Checks one file against the assignment's rules (type, extension and size). */
export function validateAssignmentAttachment(input: {
  name: string
  mimeType: string
  size: number
  rules: AssignmentAttachmentRules
}): AssignmentAttachmentValidation {
  const name = safeDisplayName(input.name)
  if (!name) return { ok: false, error: 'This file has no usable name. Rename it and try again.' }
  if (!Number.isInteger(input.size) || input.size <= 0) return { ok: false, error: `“${name}” is empty.` }

  const mimeType = attachmentMimeType({ name, mimeType: input.mimeType })
  const extension = fileExtension(name)
  const allowedExtensions = ATTACHMENT_TYPES[mimeType]
  if (!allowedExtensions || !allowedExtensions.includes(extension)) {
    return { ok: false, error: `“${name}” is not a supported file type. Attach a PDF, Office document, image, text or ZIP file.` }
  }
  if (!acceptedByAssignment(extension, input.rules.acceptedExtensions)) {
    return { ok: false, error: `“${name}” is not accepted for this assignment. Accepted: ${input.rules.acceptedExtensions.join(', ')}.` }
  }
  const limit = Math.min(input.rules.maxUploadBytes, ASSIGNMENT_ATTACHMENT_LIMITS.maxUploadBytes)
  if (input.size > limit) {
    return { ok: false, error: `“${name}” is larger than ${Math.max(1, Math.round(limit / (1024 * 1024)))} MB.` }
  }
  return { ok: true, mimeType, extension, name }
}

/** Where one attached file is stored: one prefix per submission (the attempt id). */
export function buildAssignmentAttachmentPath(input: {
  enrollmentId: string
  lessonId: string
  submissionId: string
  extension: string
  fileId?: string
}) {
  const fileId = input.fileId ?? crypto.randomUUID()
  for (const id of [input.enrollmentId, input.lessonId, input.submissionId, fileId]) {
    if (!UUID_PATTERN.test(id)) throw new Error('assignment_attachment_path_invalid')
  }
  if (!/^[a-z0-9]{1,10}$/.test(input.extension)) throw new Error('assignment_attachment_path_invalid')
  return `${ASSIGNMENT_ATTACHMENT_ROOT}/${input.enrollmentId}/${input.lessonId}/${input.submissionId}/${fileId}.${input.extension}`
}

/** The per-submission prefix every attached file of one submission shares. */
export function assignmentSubmissionPrefix(input: { enrollmentId: string; lessonId: string; submissionId: string }) {
  return `${ASSIGNMENT_ATTACHMENT_ROOT}/${input.enrollmentId}/${input.lessonId}/${input.submissionId}/`
}

/** True when a path is a file of exactly this submission, with the given extension. */
export function isAssignmentAttachmentPath(input: {
  enrollmentId: string
  lessonId: string
  submissionId: string
  extension: string
  storagePath: string
}) {
  const prefix = assignmentSubmissionPrefix(input)
  if (!input.storagePath.startsWith(prefix)) return false
  const filename = input.storagePath.slice(prefix.length)
  const suffix = `.${input.extension}`
  if (!filename.endsWith(suffix)) return false
  return UUID_PATTERN.test(filename.slice(0, -suffix.length))
}

/** Same-origin route that checks the viewer may see the file before redirecting to a short-lived URL. */
export function assignmentAttachmentRoute(attachmentId: string) {
  return `/api/learn/assignment-attachments/${encodeURIComponent(attachmentId)}`
}

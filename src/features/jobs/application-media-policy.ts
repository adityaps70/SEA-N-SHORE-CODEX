export const JOB_APPLICATION_CV_MIME = 'application/pdf' as const
export const MAX_JOB_APPLICATION_CV_BYTES = 10 * 1024 * 1024

export type JobApplicationCvMetadata = {
  fileName: string
  mimeType: typeof JOB_APPLICATION_CV_MIME
  sizeBytes: number
}

export function validateJobApplicationCvMetadata(input: {
  fileName: string
  mimeType: string
  sizeBytes: number
}): { ok: true } & JobApplicationCvMetadata | { ok: false } {
  const fileName = input.fileName.trim()
  const mimeType = input.mimeType.trim().toLowerCase()
  if (!fileName || fileName.length > 255) return { ok: false }
  if (!fileName.toLowerCase().endsWith('.pdf')) return { ok: false }
  if (mimeType !== JOB_APPLICATION_CV_MIME) return { ok: false }
  if (!Number.isInteger(input.sizeBytes) || input.sizeBytes < 1 || input.sizeBytes > MAX_JOB_APPLICATION_CV_BYTES) {
    return { ok: false }
  }

  return {
    ok: true,
    fileName,
    mimeType: JOB_APPLICATION_CV_MIME,
    sizeBytes: input.sizeBytes,
  }
}

export function buildJobApplicationCvStoragePath(input: {
  profileId: string
  jobId: string
}) {
  return `job-applications/${input.profileId}/${input.jobId}/${crypto.randomUUID()}.pdf`
}

export function isOwnedJobApplicationCvStoragePath(input: {
  profileId: string
  jobId: string
  storagePath: string
}) {
  const prefix = `job-applications/${input.profileId}/${input.jobId}/`
  if (!input.storagePath.startsWith(prefix)) return false
  const fileName = input.storagePath.slice(prefix.length)
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i.test(fileName)
}

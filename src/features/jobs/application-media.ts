import {
  createMediaUploadUrl,
  deleteMediaObject,
  headMediaObject,
} from '@/lib/aws/storage'
import {
  buildJobApplicationCvStoragePath,
  isOwnedJobApplicationCvStoragePath,
  validateJobApplicationCvMetadata,
} from './application-media-policy'

export type JobApplicationCvReference = {
  storagePath: string
  fileName: string
  mimeType: 'application/pdf'
  sizeBytes: number
}

export async function createPendingJobApplicationCvUpload(input: {
  profileId: string
  jobId: string
  fileName: string
  mimeType: string
  sizeBytes: number
}): Promise<JobApplicationCvReference & { uploadUrl: string }> {
  const metadata = validateJobApplicationCvMetadata(input)
  if (!metadata.ok) throw new Error('job_application_cv_policy_invalid')

  const storagePath = buildJobApplicationCvStoragePath({
    profileId: input.profileId,
    jobId: input.jobId,
  })
  const uploadUrl = await createMediaUploadUrl({
    key: storagePath,
    contentType: metadata.mimeType,
  })

  return {
    storagePath,
    fileName: metadata.fileName,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
    uploadUrl,
  }
}

function normalizedMediaType(value: string | null) {
  return value?.split(';', 1)[0]?.trim().toLowerCase() ?? null
}

export async function verifyPendingJobApplicationCv(input: {
  profileId: string
  jobId: string
} & JobApplicationCvReference): Promise<JobApplicationCvReference> {
  const metadata = validateJobApplicationCvMetadata({
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  })
  if (!metadata.ok) throw new Error('job_application_cv_policy_invalid')

  if (!isOwnedJobApplicationCvStoragePath({
    profileId: input.profileId,
    jobId: input.jobId,
    storagePath: input.storagePath,
  })) {
    throw new Error('job_application_cv_reference_invalid')
  }

  let stored: Awaited<ReturnType<typeof headMediaObject>>
  try {
    stored = await headMediaObject(input.storagePath)
  } catch {
    throw new Error('job_application_cv_unavailable')
  }

  if (
    normalizedMediaType(stored.contentType) !== metadata.mimeType
    || stored.contentLength !== metadata.sizeBytes
  ) {
    throw new Error('job_application_cv_metadata_mismatch')
  }

  return {
    storagePath: input.storagePath,
    fileName: metadata.fileName,
    mimeType: metadata.mimeType,
    sizeBytes: metadata.sizeBytes,
  }
}

export async function removeJobApplicationCv(storagePath: string) {
  await deleteMediaObject(storagePath)
}

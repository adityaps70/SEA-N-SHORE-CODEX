'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { DG_PROFILE_FILE_ERROR, type ProfileDocumentSummary } from './profile-document-policy'
import {
  confirmDgProfileUploadForProfile,
  DG_PROFILE_MESSAGES,
  prepareDgProfileUploadForProfile,
  removeDgProfileDocumentForProfile,
  type DgProfileUploadTicket,
  type DocumentResult,
} from './profile-document-service'

const metadataSchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(100),
  sizeBytes: z.number().int(),
})

const referenceSchema = z.object({
  storagePath: z.string().min(1).max(1024),
  fileName: z.string().min(1).max(255),
  sizeBytes: z.number().int(),
})

const SESSION_EXPIRED = 'Your session may have expired. Sign in again and retry the upload.'

async function currentUserId() {
  try {
    return (await requireAwsUser()).id
  } catch {
    return null
  }
}

export async function prepareDgProfileUpload(input: unknown): Promise<DocumentResult<DgProfileUploadTicket>> {
  const parsed = metadataSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: DG_PROFILE_FILE_ERROR }
  const userId = await currentUserId()
  if (!userId) return { ok: false, error: SESSION_EXPIRED }
  try {
    return await prepareDgProfileUploadForProfile(userId, parsed.data)
  } catch {
    return { ok: false, error: DG_PROFILE_MESSAGES.prepareFailed }
  }
}

export async function confirmDgProfileUpload(input: unknown): Promise<DocumentResult<{ document: ProfileDocumentSummary }>> {
  const parsed = referenceSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: DG_PROFILE_MESSAGES.mismatch }
  const userId = await currentUserId()
  if (!userId) return { ok: false, error: SESSION_EXPIRED }
  try {
    const result = await confirmDgProfileUploadForProfile(userId, parsed.data)
    if (result.ok) revalidatePath('/profile')
    return result
  } catch {
    return { ok: false, error: DG_PROFILE_MESSAGES.saveFailed }
  }
}

export async function removeDgProfileUpload(): Promise<DocumentResult<Record<never, never>>> {
  const userId = await currentUserId()
  if (!userId) return { ok: false, error: 'Your session may have expired. Sign in again and retry.' }
  try {
    await removeDgProfileDocumentForProfile(userId)
  } catch {
    return { ok: false, error: DG_PROFILE_MESSAGES.removeFailed }
  }
  revalidatePath('/profile')
  return { ok: true }
}

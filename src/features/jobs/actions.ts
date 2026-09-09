'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { jobsRepository } from './repository'

export type ApplyToJobResult =
  | { ok: true; alreadyApplied: boolean }
  | { ok: false; error: string }

const jobIdSchema = z.string().uuid()

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

export async function applyToJob(jobId: string): Promise<ApplyToJobResult> {
  const parsed = jobIdSchema.safeParse(jobId)
  if (!parsed.success) return { ok: false, error: 'Invalid job.' }

  const user = await requireAwsUser()
  const job = await jobsRepository.getPublishedJob(parsed.data)
  if (!job) return { ok: false, error: 'This job is no longer accepting applications.' }

  if (await jobsRepository.hasApplied(parsed.data, user.id)) {
    return { ok: true, alreadyApplied: true }
  }

  try {
    await jobsRepository.createApplication(parsed.data, user.id)
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: true, alreadyApplied: true }
    return { ok: false, error: 'We could not submit your application. Please try again.' }
  }

  revalidatePath('/jobs')
  revalidatePath(`/jobs/${parsed.data}`)
  revalidatePath('/activities')
  return { ok: true, alreadyApplied: false }
}

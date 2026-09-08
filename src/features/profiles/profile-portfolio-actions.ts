'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getAwsOwnProfile } from './aws-queries'
import {
  createProfileCredentialRecord,
  createProfileExperienceRecord,
  deleteProfileCredentialRecord,
  deleteProfileExperienceRecord,
  updateProfileCredentialRecord,
  updateProfileExperienceRecord,
} from './profile-portfolio-repository'
import {
  profileCredentialIdSchema,
  profileCredentialInputSchema,
  profileExperienceIdSchema,
  profileExperienceInputSchema,
} from './profile-portfolio-schemas'

export type ProfilePortfolioActionState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: boolean
  revision?: number
}

function failure(previousState: ProfilePortfolioActionState, error: string): ProfilePortfolioActionState {
  return { error, revision: (previousState.revision ?? 0) + 1 }
}

function validationFailure(
  previousState: ProfilePortfolioActionState,
  fieldErrors: Record<string, string[]>,
): ProfilePortfolioActionState {
  return { fieldErrors, revision: (previousState.revision ?? 0) + 1 }
}

function success(previousState: ProfilePortfolioActionState): ProfilePortfolioActionState {
  return { success: true, revision: (previousState.revision ?? 0) + 1 }
}

function revalidateProfile(slug: string) {
  revalidatePath('/profile')
  revalidatePath(`/people/${slug}`)
}

export async function createProfileExperience(
  previousState: ProfilePortfolioActionState,
  formData: FormData,
): Promise<ProfilePortfolioActionState> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) return failure(previousState, 'We could not load your profile. Please refresh and try again.')

  const parsed = profileExperienceInputSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return validationFailure(previousState, parsed.error.flatten().fieldErrors as Record<string, string[]>)
  }

  try {
    await createProfileExperienceRecord(user.id, parsed.data)
  } catch {
    return failure(previousState, 'We could not add this experience. Please try again.')
  }

  revalidateProfile(profile.slug)
  return success(previousState)
}

export async function updateProfileExperience(
  experienceId: string,
  previousState: ProfilePortfolioActionState,
  formData: FormData,
): Promise<ProfilePortfolioActionState> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) return failure(previousState, 'We could not load your profile. Please refresh and try again.')

  const id = profileExperienceIdSchema.safeParse(experienceId)
  if (!id.success) return failure(previousState, 'That career record is invalid.')

  const parsed = profileExperienceInputSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return validationFailure(previousState, parsed.error.flatten().fieldErrors as Record<string, string[]>)
  }

  try {
    const updated = await updateProfileExperienceRecord(user.id, id.data, parsed.data)
    if (!updated) return failure(previousState, 'That career record is no longer available.')
  } catch {
    return failure(previousState, 'We could not save this experience. Please try again.')
  }

  revalidateProfile(profile.slug)
  return success(previousState)
}

export async function deleteProfileExperience(experienceId: string): Promise<{ success: boolean; error?: string }> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) return { success: false, error: 'We could not load your profile.' }

  const id = profileExperienceIdSchema.safeParse(experienceId)
  if (!id.success) return { success: false, error: 'That career record is invalid.' }

  try {
    const deleted = await deleteProfileExperienceRecord(user.id, id.data)
    if (!deleted) return { success: false, error: 'That career record is no longer available.' }
  } catch {
    return { success: false, error: 'We could not delete this experience. Please try again.' }
  }

  revalidateProfile(profile.slug)
  return { success: true }
}

export async function createProfileCredential(
  previousState: ProfilePortfolioActionState,
  formData: FormData,
): Promise<ProfilePortfolioActionState> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) return failure(previousState, 'We could not load your profile. Please refresh and try again.')

  const parsed = profileCredentialInputSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return validationFailure(previousState, parsed.error.flatten().fieldErrors as Record<string, string[]>)
  }

  try {
    await createProfileCredentialRecord(user.id, parsed.data)
  } catch {
    return failure(previousState, 'We could not add this credential. Please try again.')
  }

  revalidateProfile(profile.slug)
  return success(previousState)
}

export async function updateProfileCredential(
  credentialId: string,
  previousState: ProfilePortfolioActionState,
  formData: FormData,
): Promise<ProfilePortfolioActionState> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) return failure(previousState, 'We could not load your profile. Please refresh and try again.')

  const id = profileCredentialIdSchema.safeParse(credentialId)
  if (!id.success) return failure(previousState, 'That credential is invalid.')

  const parsed = profileCredentialInputSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return validationFailure(previousState, parsed.error.flatten().fieldErrors as Record<string, string[]>)
  }

  try {
    const updated = await updateProfileCredentialRecord(user.id, id.data, parsed.data)
    if (!updated) return failure(previousState, 'That credential is no longer available.')
  } catch {
    return failure(previousState, 'We could not save this credential. Please try again.')
  }

  revalidateProfile(profile.slug)
  return success(previousState)
}

export async function deleteProfileCredential(credentialId: string): Promise<{ success: boolean; error?: string }> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) return { success: false, error: 'We could not load your profile.' }

  const id = profileCredentialIdSchema.safeParse(credentialId)
  if (!id.success) return { success: false, error: 'That credential is invalid.' }

  try {
    const deleted = await deleteProfileCredentialRecord(user.id, id.data)
    if (!deleted) return { success: false, error: 'That credential is no longer available.' }
  } catch {
    return { success: false, error: 'We could not delete this credential. Please try again.' }
  }

  revalidateProfile(profile.slug)
  return { success: true }
}

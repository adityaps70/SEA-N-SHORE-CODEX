'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getAwsOwnProfile } from './aws-queries'
import {
  updateProfileAboutSectionWithAurora,
  updateProfileIdentitySectionWithAurora,
  updateProfileProfessionalSectionWithAurora,
} from './profile-inline-edit-service'
import {
  profileAboutSectionSchema,
  profileIdentitySectionSchema,
  profileProfessionalSectionSchema,
} from './profile-inline-schemas'

export type ProfileInlineActionState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  success?: boolean
  revision?: number
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

function nextFailure(
  previousState: ProfileInlineActionState,
  failure: Pick<ProfileInlineActionState, 'error' | 'fieldErrors'>,
): ProfileInlineActionState {
  return { ...failure, revision: (previousState.revision ?? 0) + 1 }
}

function validationFailure(
  previousState: ProfileInlineActionState,
  error: { flatten: () => { fieldErrors: unknown } },
): ProfileInlineActionState {
  return nextFailure(previousState, {
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  })
}

function successState(previousState: ProfileInlineActionState): ProfileInlineActionState {
  return { success: true, revision: (previousState.revision ?? 0) + 1 }
}

function revalidateProfilePaths(slug: string) {
  revalidatePath('/profile')
  revalidatePath('/home')
  revalidatePath(`/people/${slug}`)
}

export async function updateProfileIdentitySection(
  previousState: ProfileInlineActionState,
  formData: FormData,
): Promise<ProfileInlineActionState> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) return nextFailure(previousState, { error: 'We could not load your profile. Please refresh and try again.' })

  const parsed = profileIdentitySectionSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return validationFailure(previousState, parsed.error)

  try {
    await updateProfileIdentitySectionWithAurora(
      user.id,
      parsed.data,
      profile.profileType === 'seafarer' || profile.profileType === 'maritime_professional',
    )
  } catch (error) {
    if (isUniqueViolation(error)) {
      return nextFailure(previousState, { fieldErrors: { slug: ['That profile address is already in use.'] } })
    }
    return nextFailure(previousState, { error: 'We could not save this section. Please try again.' })
  }

  revalidateProfilePaths(profile.slug)
  if (parsed.data.slug !== profile.slug) revalidatePath(`/people/${parsed.data.slug}`)
  return successState(previousState)
}

export async function updateProfileAboutSection(
  previousState: ProfileInlineActionState,
  formData: FormData,
): Promise<ProfileInlineActionState> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) return nextFailure(previousState, { error: 'We could not load your profile. Please refresh and try again.' })

  const parsed = profileAboutSectionSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return validationFailure(previousState, parsed.error)

  try {
    await updateProfileAboutSectionWithAurora(user.id, parsed.data)
  } catch {
    return nextFailure(previousState, { error: 'We could not save this section. Please try again.' })
  }

  revalidateProfilePaths(profile.slug)
  return successState(previousState)
}

export async function updateProfileProfessionalSection(
  previousState: ProfileInlineActionState,
  formData: FormData,
): Promise<ProfileInlineActionState> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) return nextFailure(previousState, { error: 'We could not load your profile. Please refresh and try again.' })
  if (profile.profileType !== 'seafarer' && profile.profileType !== 'maritime_professional') {
    return nextFailure(previousState, { error: 'Maritime experience is not available for this profile type.' })
  }

  const parsed = profileProfessionalSectionSchema.safeParse({
    ...Object.fromEntries(formData),
    profileType: profile.profileType,
  })
  if (!parsed.success) return validationFailure(previousState, parsed.error)

  try {
    await updateProfileProfessionalSectionWithAurora(user.id, parsed.data)
  } catch {
    return nextFailure(previousState, { error: 'We could not save this section. Please try again.' })
  }

  revalidateProfilePaths(profile.slug)
  return successState(previousState)
}

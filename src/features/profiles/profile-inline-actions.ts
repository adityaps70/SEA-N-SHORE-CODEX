'use server'

import { revalidatePath } from 'next/cache'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { assessPlatformText, automatedModerationDetails, moderationBlockMessage, type AutomatedModerationAssessment } from '@/features/moderation/automated'
import { moderationRepository } from '@/features/moderation/repository'
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

function assessProfileSection(value: object): AutomatedModerationAssessment {
  const parts = Object.values(value).flatMap((entry) => {
    if (typeof entry === 'string') return [entry]
    if (Array.isArray(entry)) return entry.filter((item): item is string => typeof item === 'string')
    return []
  })
  return assessPlatformText(parts)
}

async function flagProfileModeration(profileId: string, assessment: AutomatedModerationAssessment) {
  if (assessment.decision !== 'review' || !assessment.reason) return
  const details = automatedModerationDetails(assessment)
  if (!details) return
  try {
    await moderationRepository.flagContentAutomatically({
      targetType: 'profile',
      targetId: profileId,
      reason: assessment.reason,
      details,
    })
  } catch (error) {
    console.error('profile_inline_automated_moderation_flag_failed', {
      profileId,
      message: error instanceof Error ? error.message : null,
    })
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

function isServiceError(error: unknown, code: string) {
  return error instanceof Error && error.message === code
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
  const moderation = assessProfileSection(parsed.data)
  if (moderation.decision === 'block') return nextFailure(previousState, { error: moderationBlockMessage() })

  try {
    await updateProfileIdentitySectionWithAurora(
      user.id,
      parsed.data,
      profile.profileType === 'seafarer' || profile.profileType === 'maritime_professional',
    )
    await flagProfileModeration(user.id, moderation)
  } catch (error) {
    if (isUniqueViolation(error)) {
      return nextFailure(previousState, { fieldErrors: { slug: ['That username is already in use.'] } })
    }
    if (isServiceError(error, 'username_change_limit')) {
      return nextFailure(previousState, { fieldErrors: { slug: ['You have used both username changes. Your username is now locked.'] } })
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
  const moderation = assessProfileSection(parsed.data)
  if (moderation.decision === 'block') return nextFailure(previousState, { error: moderationBlockMessage() })

  try {
    await updateProfileAboutSectionWithAurora(user.id, parsed.data)
    await flagProfileModeration(user.id, moderation)
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
  const moderation = assessProfileSection(parsed.data)
  if (moderation.decision === 'block') return nextFailure(previousState, { error: moderationBlockMessage() })

  try {
    await updateProfileProfessionalSectionWithAurora(user.id, parsed.data)
    await flagProfileModeration(user.id, moderation)
  } catch {
    return nextFailure(previousState, { error: 'We could not save this section. Please try again.' })
  }

  revalidateProfilePaths(profile.slug)
  return successState(previousState)
}

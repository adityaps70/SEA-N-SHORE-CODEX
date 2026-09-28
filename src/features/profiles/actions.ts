'use server'

import { redirect } from 'next/navigation'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { assessPlatformText, automatedModerationDetails, moderationBlockMessage, type AutomatedModerationAssessment } from '@/features/moderation/automated'
import { moderationRepository } from '@/features/moderation/repository'
import { getAwsOwnProfile } from './aws-queries'
import { completeActivationWithAurora, completeOnboardingWithAurora } from './onboarding-service'
import { updateProfileWithAurora } from './profile-edit-service'
import { onboardingActivationSchema, onboardingSchema } from './schemas'
import { organizationLinkRepository } from './organization-link-repository'
import { resolveCurrentOrganizationLink } from './organization-link-service'
import { PERSONAS, type Persona } from './persona'
import { profilePreferencesSchema } from './profile-preferences'
import { updateProfilePreferencesWithAurora } from './profile-preferences-service'
import { PROFILE_TYPES, type ProfileType } from './types'
import { removeDgProfileDocumentForProfile } from './profile-document-service'
import { normalizeUsername, usernameSchema } from './username'
import { checkUsernameAvailabilityFromAurora, suggestAvailableUsernameFromAurora } from './username-availability'

export type OnboardingFormValues = {
  profileType?: ProfileType
  persona?: Persona
  profileIntents?: string
  identityRoot?: 'professional' | 'organisation'
  primaryIdentity?: string
  primaryIdentityFamily?: string
  secondaryIdentities?: string
  fullName?: string
  slug?: string
  usernameSuggestion?: string
  location?: string
  headline?: string
  summary?: string
  contactVisibility?: 'private' | 'members' | 'public'
  skills?: string
  rank?: string
  currentCompany?: string
  currentCompanyId?: string
  specialization?: string
  institutionName?: string
  familyRelationship?: string
  currentVessel?: string
  sailingExperienceYears?: string
  vesselTypes?: string
  tradingAreas?: string
  shoreCareerPreference?: boolean
}

export type ProfileActionState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  revision?: number
  values?: OnboardingFormValues
}

const boundedTextFields = {
  profileIntents: 512,
  usernameSuggestion: 80,
  primaryIdentity: 120,
  primaryIdentityFamily: 120,
  secondaryIdentities: 1600,
  fullName: 160,
  slug: 80,
  location: 120,
  headline: 160,
  summary: 2000,
  skills: 2000,
  rank: 100,
  currentCompany: 160,
  currentCompanyId: 64,
  specialization: 500,
  institutionName: 160,
  familyRelationship: 80,
  currentVessel: 160,
  sailingExperienceYears: 32,
  vesselTypes: 2000,
  tradingAreas: 2000,
} as const

function readBoundedText(formData: FormData, name: string, maximum: number) {
  const value = formData.get(name)
  return typeof value === 'string' && value.length <= maximum ? value : undefined
}

function captureSafeValues(formData: FormData): OnboardingFormValues {
  const values: OnboardingFormValues = {
    shoreCareerPreference: ['on', 'true'].includes(String(formData.get('shoreCareerPreference') ?? '')),
  }
  const profileType = PROFILE_TYPES.find((value) => value === formData.get('profileType'))
  const persona = PERSONAS.find((value) => value === formData.get('persona'))
  const identityRoot = (['professional', 'organisation'] as const).find((value) => value === formData.get('identityRoot'))
  const contactVisibility = (['private', 'members', 'public'] as const)
    .find((value) => value === formData.get('contactVisibility'))

  if (profileType) values.profileType = profileType
  if (persona) values.persona = persona
  if (identityRoot) values.identityRoot = identityRoot
  if (contactVisibility) values.contactVisibility = contactVisibility

  for (const [name, maximum] of Object.entries(boundedTextFields)) {
    const value = readBoundedText(formData, name, maximum)
    if (value !== undefined) values[name as keyof typeof boundedTextFields] = value as never
  }

  return values
}

function failureState(
  previousState: ProfileActionState,
  formData: FormData,
  failure: Pick<ProfileActionState, 'error' | 'fieldErrors'>,
): ProfileActionState {
  return {
    ...failure,
    revision: (previousState.revision ?? 0) + 1,
    values: captureSafeValues(formData),
  }
}

function isUniqueViolation(error: unknown) {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === '23505')
}

function isServiceError(error: unknown, code: string) {
  return error instanceof Error && error.message === code
}

function profileModerationAssessment(value: object): AutomatedModerationAssessment {
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
    console.error('profile_automated_moderation_flag_failed', {
      profileId,
      message: error instanceof Error ? error.message : null,
    })
  }
}

const ORGANIZATION_LOOKUP_FAILED = 'We could not check the organization you chose. Your entries are still here; please try again.'

/** Confirms a picked organization is listed on Sea N Shore; null when the lookup itself failed. */
async function linkCurrentOrganization<T extends { currentCompany?: string; currentCompanyId?: string }>(data: T, userId: string) {
  try {
    return await resolveCurrentOrganizationLink(data, organizationLinkRepository, { userId })
  } catch {
    return null
  }
}

function validationFailure(previousState: ProfileActionState, formData: FormData, error: { flatten: () => { fieldErrors: unknown } }) {
  return failureState(previousState, formData, {
    fieldErrors: error.flatten().fieldErrors as Record<string, string[]>,
  })
}

export async function completeOnboarding(
  previousState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const parsed = onboardingSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return validationFailure(previousState, formData, parsed.error)

  const moderation = profileModerationAssessment(parsed.data)
  if (moderation.decision === 'block') {
    return failureState(previousState, formData, { error: moderationBlockMessage() })
  }
  let user
  try {
    user = await requireAwsUser()
  } catch {
    return failureState(previousState, formData, {
      error: 'Your session may have expired. Sign in again, return to onboarding, and submit this step again.',
    })
  }

  const linked = await linkCurrentOrganization(parsed.data, user.id)
  if (!linked) return failureState(previousState, formData, { error: ORGANIZATION_LOOKUP_FAILED })
  if (!linked.ok) return failureState(previousState, formData, { fieldErrors: linked.fieldErrors })
  const data = linked.data

  try {
    await completeOnboardingWithAurora(user.id, data)
    await flagProfileModeration(user.id, moderation)
  } catch (error) {
    if (isUniqueViolation(error)) {
      return failureState(previousState, formData, {
        fieldErrors: { slug: ['That username is already in use. Choose a different username and try again.'] },
      })
    }
    return failureState(previousState, formData, {
      error: 'We could not save your profile. Your entries are still here; please try again.',
    })
  }

  redirect('/home')
}

type OnboardingUsernameChoice = { slug: string; autoGenerated: boolean }

/**
 * A first-time member never has to fix a username to finish onboarding: a
 * valid, available handle they typed or kept is used as-is, and anything else
 * (empty, invalid, reserved, taken) is replaced with a generated handle they
 * can change later from their profile.
 */
async function resolveOnboardingUsername(
  profileId: string,
  input: { submitted: unknown; suggested: unknown; fullName: unknown; email: string | null },
  options: { forceGenerated?: boolean } = {},
): Promise<OnboardingUsernameChoice> {
  const suggested = typeof input.suggested === 'string' ? normalizeUsername(input.suggested) : ''
  const submitted = usernameSchema.safeParse(input.submitted)
  if (!options.forceGenerated && submitted.success) {
    const availability = await checkUsernameAvailabilityFromAurora(profileId, submitted.data)
    if (availability.available) {
      return { slug: submitted.data, autoGenerated: submitted.data === suggested }
    }
  }

  const slug = await suggestAvailableUsernameFromAurora(profileId, {
    fullName: typeof input.fullName === 'string' ? input.fullName : null,
    email: input.email,
  })
  return { slug, autoGenerated: true }
}

async function discardDgProfileForNonSeafarer(profileId: string, persona: Persona) {
  if (persona === 'seafarer') return
  try {
    await removeDgProfileDocumentForProfile(profileId)
  } catch (error) {
    console.error('onboarding_dg_profile_cleanup_failed', {
      profileId,
      message: error instanceof Error ? error.message : null,
    })
  }
}

export async function completeActivation(
  previousState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  let user
  try {
    user = await requireAwsUser()
  } catch {
    return failureState(previousState, formData, {
      error: 'Your session may have expired. Sign in again, return to onboarding, and submit this step again.',
    })
  }

  const rawValues = Object.fromEntries(formData)
  const usernameInput = {
    submitted: rawValues.slug,
    suggested: rawValues.usernameSuggestion,
    fullName: rawValues.fullName,
    email: user.email,
  }

  let username: OnboardingUsernameChoice
  try {
    username = await resolveOnboardingUsername(user.id, usernameInput)
  } catch {
    return failureState(previousState, formData, {
      error: 'We could not save your profile. Your entries are still here; please try again.',
    })
  }

  const parsed = onboardingActivationSchema.safeParse({ ...rawValues, slug: username.slug })
  if (!parsed.success) return validationFailure(previousState, formData, parsed.error)

  const linked = await linkCurrentOrganization(parsed.data, user.id)
  if (!linked) return failureState(previousState, formData, { error: ORGANIZATION_LOOKUP_FAILED })
  if (!linked.ok) return failureState(previousState, formData, { fieldErrors: linked.fieldErrors })
  const activation = linked.data

  const moderation = profileModerationAssessment(activation)
  if (moderation.decision === 'block') {
    return failureState(previousState, formData, { error: moderationBlockMessage() })
  }

  try {
    try {
      await completeActivationWithAurora(user.id, activation, { usernameAutoGenerated: username.autoGenerated })
    } catch (error) {
      if (!isUniqueViolation(error)) throw error
      // Someone claimed the handle between the check and the save: pick another one and finish anyway.
      username = await resolveOnboardingUsername(user.id, usernameInput, { forceGenerated: true })
      await completeActivationWithAurora(user.id, { ...activation, slug: username.slug }, { usernameAutoGenerated: true })
    }
    await flagProfileModeration(user.id, moderation)
  } catch {
    return failureState(previousState, formData, {
      error: 'We could not save your profile. Your entries are still here; please try again.',
    })
  }

  await discardDgProfileForNonSeafarer(user.id, activation.persona)
  redirect('/home')
}

export async function updateProfilePreferences(
  previousState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const parsed = profilePreferencesSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return validationFailure(previousState, formData, parsed.error)

  const moderation = profileModerationAssessment(parsed.data)
  if (moderation.decision === 'block') {
    return failureState(previousState, formData, { error: moderationBlockMessage() })
  }

  let user
  try {
    user = await requireAwsUser()
  } catch {
    return failureState(previousState, formData, {
      error: 'Your session may have expired. Sign in again and try saving your profile preferences.',
    })
  }

  try {
    await updateProfilePreferencesWithAurora(user.id, parsed.data)
    await flagProfileModeration(user.id, moderation)
  } catch {
    return failureState(previousState, formData, {
      error: 'We could not save your profile preferences. Your selections are still here; please try again.',
    })
  }

  redirect('/profile')
}

export async function updateProfile(
  previousState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) {
    return failureState(previousState, formData, {
      error: 'We could not load your profile. Please refresh and try again.',
    })
  }

  const rawValues = Object.fromEntries(formData)
  const parsed = onboardingSchema.safeParse({ ...rawValues, profileType: profile.profileType })
  if (!parsed.success) return validationFailure(previousState, formData, parsed.error)

  const linked = await linkCurrentOrganization(parsed.data, user.id)
  if (!linked) return failureState(previousState, formData, { error: ORGANIZATION_LOOKUP_FAILED })
  if (!linked.ok) return failureState(previousState, formData, { fieldErrors: linked.fieldErrors })
  const data = linked.data

  const moderation = profileModerationAssessment(data)
  if (moderation.decision === 'block') {
    return failureState(previousState, formData, { error: moderationBlockMessage() })
  }

  try {
    // A cleared organization field clears the saved organization; an absent field leaves it alone.
    await updateProfileWithAurora(user.id, data, true, { currentCompanySubmitted: formData.has('currentCompany') })
    await flagProfileModeration(user.id, moderation)
  } catch (error) {
    if (isUniqueViolation(error)) {
      return failureState(previousState, formData, {
        fieldErrors: { slug: ['That username is already in use.'] },
      })
    }
    if (isServiceError(error, 'username_change_limit')) {
      return failureState(previousState, formData, {
        fieldErrors: { slug: ['You have used both username changes. Your username is now locked.'] },
      })
    }
    return failureState(previousState, formData, {
      error: 'We could not save your profile. Your entries are still here; please try again.',
    })
  }

  redirect('/profile')
}

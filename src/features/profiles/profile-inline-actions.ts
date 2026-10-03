'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { assessPlatformText, automatedModerationDetails, moderationBlockMessage, type AutomatedModerationAssessment } from '@/features/moderation/automated'
import { moderationRepository } from '@/features/moderation/repository'
import { getAwsOwnProfile } from './aws-queries'
import { optionalOrganizationIdSchema } from './organization-link'
import { organizationLinkRepository } from './organization-link-repository'
import { resolveCurrentOrganizationLink } from './organization-link-service'
import { personaUsesProfessionalCompany, type ProfileIntent } from './persona'
import {
  setProfileCurrentOrganizationWithAurora,
  updateProfileAboutSectionWithAurora,
  updateProfileGoalsSectionWithAurora,
  updateProfileIdentitySectionWithAurora,
  updateProfileProfessionalSectionWithAurora,
  type ProfileCardPreferences,
} from './profile-inline-edit-service'
import {
  profileAboutSectionSchema,
  profileIdentitySectionSchema,
  profileProfessionalSectionSchema,
} from './profile-inline-schemas'
import { personaForProfile } from './profile-persona-rules'
import { profilePreferencesSchema, retainedPersonaDetailsSchema } from './profile-preferences'
import { editableRankSchema } from './schemas'
import type { OwnProfile } from './types'

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

type CardPreferencesResult =
  | { ok: true; preferences?: ProfileCardPreferences }
  | { ok: false; fieldErrors: Record<string, string[]> }

function sameText(left: unknown, right: string | null | undefined) {
  const submitted = typeof left === 'string' ? left.trim() : ''
  return submitted === (right?.trim() ?? '')
}

/**
 * Reads a profile type (persona) change submitted with a card, validated by the same schema as the
 * profile type & goals form. Saved persona details that the editor kept on screen are retained.
 * A profile from before personas existed only takes a persona when the member changed something.
 */
function readCardPreferences(
  profile: OwnProfile,
  formData: FormData,
  intents: ProfileIntent[] | string,
): CardPreferencesResult {
  const raw = Object.fromEntries(formData)
  const parsed = profilePreferencesSchema.safeParse({ ...raw, profileIntents: intents })
  if (!parsed.success) return { ok: false, fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]> }
  const retained = retainedPersonaDetailsSchema.safeParse(raw)
  if (!retained.success) return { ok: false, fieldErrors: retained.error.flatten().fieldErrors as Record<string, string[]> }

  if (parsed.data.persona === 'seafarer') {
    const rank = typeof raw.rank === 'string' ? raw.rank.trim() : ''
    if (rank.length < 2) return { ok: false, fieldErrors: { rank: ['Add your current or most recent rank.'] } }
  }

  if (!profile.persona && typeof intents !== 'string') {
    const unchanged = parsed.data.persona === personaForProfile(profile)
      && sameText(raw.familyRelationship, profile.communityRelationship)
      && sameText(raw.institutionName, profile.institutionName)
      && sameText(raw.specialization, profile.specialization)
    if (unchanged) return { ok: true }
  }

  return {
    ok: true,
    preferences: {
      data: parsed.data,
      retained: {
        communityRelationship: formData.has('familyRelationship') ? retained.data.familyRelationship ?? null : null,
        institutionName: formData.has('institutionName') ? retained.data.institutionName ?? null : null,
        specialization: formData.has('specialization') ? retained.data.specialization ?? null : null,
      },
    },
  }
}

function savedIntents(profile: OwnProfile): ProfileIntent[] {
  return profile.profileIntents?.length ? profile.profileIntents : ['community']
}

/**
 * The header pencil: profile type, name, username, headline, location, current organization,
 * rank and contact visibility (round 11). A profile type change saves through the preferences
 * service in the same transaction.
 */
export async function updateProfileIdentitySection(
  previousState: ProfileInlineActionState,
  formData: FormData,
): Promise<ProfileInlineActionState> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) return nextFailure(previousState, { error: 'We could not load your profile. Please refresh and try again.' })

  const parsed = profileIdentitySectionSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return validationFailure(previousState, parsed.error)

  const organisationAccount = profile.identityRoot === 'organisation'
  let preferences: ProfileCardPreferences | undefined
  if (!organisationAccount && formData.has('persona')) {
    const read = readCardPreferences(profile, formData, savedIntents(profile))
    if (!read.ok) return nextFailure(previousState, { fieldErrors: read.fieldErrors })
    preferences = read.preferences
  }

  let identity = parsed.data
  try {
    const linked = await resolveCurrentOrganizationLink(parsed.data, organizationLinkRepository, { userId: user.id })
    if (!linked.ok) return nextFailure(previousState, { fieldErrors: linked.fieldErrors })
    identity = linked.data
  } catch {
    return nextFailure(previousState, { error: 'We could not check the organization you chose. Please try again.' })
  }

  const moderation = assessProfileSection({ ...identity, ...preferences?.data, ...preferences?.retained })
  if (moderation.decision === 'block') return nextFailure(previousState, { error: moderationBlockMessage() })

  const persona = preferences?.data.persona ?? profile.persona
  try {
    await updateProfileIdentitySectionWithAurora(
      user.id,
      identity,
      // Round 10: a saved organization stays editable even when the persona does not ask for one.
      (persona ? personaUsesProfessionalCompany(persona) : true) || formData.has('currentCompany'),
      preferences ? { rankSubmitted: formData.has('rank'), preferences } : { rankSubmitted: formData.has('rank') },
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

/**
 * The Profile box of "Access & goals" (round 11), and the profile type & goals form on Edit
 * profile: profile type, goals and the persona details, plus the organization and rank it shows.
 */
export async function updateProfileGoalsSection(
  previousState: ProfileInlineActionState,
  formData: FormData,
): Promise<ProfileInlineActionState> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) return nextFailure(previousState, { error: 'We could not load your profile. Please refresh and try again.' })

  const intents = formData.get('profileIntents')
  const read = readCardPreferences(profile, formData, typeof intents === 'string' ? intents : '')
  if (!read.ok) return nextFailure(previousState, { fieldErrors: read.fieldErrors })
  const preferences = read.preferences
  if (!preferences) return successState(previousState)

  const rankSubmitted = formData.has('rank')
  const rank = rankSubmitted ? editableRankSchema.safeParse({ rank: formData.get('rank') }) : null
  if (rank && !rank.success) return validationFailure(previousState, rank.error)

  let organization: { currentCompany?: string; currentCompanyId?: string } | undefined
  if (formData.has('currentCompany') && profile.identityRoot !== 'organisation') {
    const submitted = organizationFieldsSchema.safeParse(Object.fromEntries(formData))
    if (!submitted.success) return validationFailure(previousState, submitted.error)
    try {
      const linked = await resolveCurrentOrganizationLink(submitted.data, organizationLinkRepository, { userId: user.id })
      if (!linked.ok) return nextFailure(previousState, { fieldErrors: linked.fieldErrors })
      organization = linked.data
    } catch {
      return nextFailure(previousState, { error: 'We could not check the organization you chose. Please try again.' })
    }
  }

  const moderation = assessProfileSection({ ...preferences.data, ...preferences.retained, ...organization, rank: rank?.data?.rank })
  if (moderation.decision === 'block') return nextFailure(previousState, { error: moderationBlockMessage() })

  try {
    await updateProfileGoalsSectionWithAurora(user.id, preferences, {
      organization,
      rankSubmitted,
      rank: rank?.success ? rank.data.rank : undefined,
    })
    await flagProfileModeration(user.id, moderation)
  } catch {
    return nextFailure(previousState, { error: 'We could not save your profile type and goals. Please try again.' })
  }

  revalidateProfilePaths(profile.slug)
  return successState(previousState)
}

const organizationFieldsSchema = z.object({
  currentCompany: z.preprocess(
    (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined),
    z.string().max(160, 'Keep the organization name to 160 characters or fewer.').optional(),
  ),
  currentCompanyId: optionalOrganizationIdSchema,
})

/**
 * The Organizations card pencil (round 11): which of the member's organizations the header shows
 * as their current one, keep the organization already saved, or show none. Only organizations the
 * member belongs to on Sea N Shore can be chosen.
 */
export async function updateProfileCurrentOrganization(
  previousState: ProfileInlineActionState,
  formData: FormData,
): Promise<ProfileInlineActionState> {
  const user = await requireAwsUser()
  const profile = await getAwsOwnProfile()
  if (!profile) return nextFailure(previousState, { error: 'We could not load your profile. Please refresh and try again.' })
  if (profile.identityRoot === 'organisation') {
    return nextFailure(previousState, { error: 'Organisation accounts do not show a current organization.' })
  }

  const choice = formData.get('currentOrganization')
  if (choice === 'keep') return successState(previousState)

  let organization: { currentCompany?: string; currentCompanyId?: string }
  if (choice === 'none') {
    organization = {}
  } else {
    const id = optionalOrganizationIdSchema.safeParse(choice)
    if (!id.success || !id.data) {
      return nextFailure(previousState, { fieldErrors: { currentOrganization: ['Choose one of your organizations, or none.'] } })
    }
    try {
      const memberships = await organizationLinkRepository.listProfileOrganizations(user.id, 50)
      const membership = memberships.find((entry) => entry.id === id.data)
      if (!membership) {
        return nextFailure(previousState, { fieldErrors: { currentOrganization: ['You can only choose an organization you belong to.'] } })
      }
      organization = { currentCompany: membership.name, currentCompanyId: membership.id }
    } catch {
      return nextFailure(previousState, { error: 'We could not check your organizations. Please try again.' })
    }
  }

  try {
    await setProfileCurrentOrganizationWithAurora(user.id, organization)
  } catch {
    return nextFailure(previousState, { error: 'We could not save your current organization. Please try again.' })
  }

  revalidateProfilePaths(profile.slug)
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
  const isSeafarer = profile.persona === 'seafarer' || (!profile.persona && profile.profileType === 'seafarer')
  if (!isSeafarer) {
    return nextFailure(previousState, { error: 'Maritime experience is available only for Seafarer profiles.' })
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

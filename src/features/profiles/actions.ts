'use server'

import { redirect } from 'next/navigation'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { completeOnboardingWithAurora } from './onboarding-service'
import { onboardingSchema } from './schemas'
import { PROFILE_TYPES, type ProfileType } from './types'

export type OnboardingFormValues = {
  profileType?: ProfileType
  fullName?: string
  slug?: string
  location?: string
  headline?: string
  summary?: string
  contactVisibility?: 'private' | 'members' | 'public'
  skills?: string
  rank?: string
  currentCompany?: string
  currentVessel?: string
  sailingExperienceYears?: string
  vesselTypes?: string
  tradingAreas?: string
  shoreCareerPreference?: boolean
  availability?: string
}

export type ProfileActionState = {
  error?: string
  fieldErrors?: Record<string, string[]>
  revision?: number
  values?: OnboardingFormValues
}

const boundedTextFields = {
  fullName: 120,
  slug: 80,
  location: 120,
  headline: 160,
  summary: 2000,
  skills: 2000,
  rank: 100,
  currentCompany: 160,
  currentVessel: 160,
  sailingExperienceYears: 32,
  vesselTypes: 2000,
  tradingAreas: 2000,
  availability: 100,
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
  const contactVisibility = (['private', 'members', 'public'] as const)
    .find((value) => value === formData.get('contactVisibility'))

  if (profileType) values.profileType = profileType
  if (contactVisibility) values.contactVisibility = contactVisibility

  for (const [name, maximum] of Object.entries(boundedTextFields)) {
    const value = readBoundedText(formData, name, maximum)
    if (value !== undefined) values[name as keyof typeof boundedTextFields] = value
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

export async function completeOnboarding(
  previousState: ProfileActionState,
  formData: FormData,
): Promise<ProfileActionState> {
  const parsed = onboardingSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    return failureState(previousState, formData, {
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    })
  }

  const user = await requireAwsUser()
  const data = parsed.data

  try {
    await completeOnboardingWithAurora(user.id, data)
  } catch (error) {
    if (isUniqueViolation(error)) {
      return failureState(previousState, formData, {
        fieldErrors: { slug: ['That profile address is already in use.'] },
      })
    }
    return failureState(previousState, formData, {
      error: 'We could not save your profile. Your entries are still here; please try again.',
    })
  }

  redirect(data.profileType === 'company' ? '/company/setup' : '/home')
}

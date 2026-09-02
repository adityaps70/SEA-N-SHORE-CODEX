'use server'

import { redirect } from 'next/navigation'
import { requireUser } from '@/features/auth/queries'
import { createServerSupabaseClient } from '@/lib/supabase/server'
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

  await requireUser()
  const data = parsed.data
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.rpc('complete_onboarding', {
    p_profile_type: data.profileType,
    p_full_name: data.fullName,
    p_slug: data.slug,
    p_location: data.location ?? '',
    p_headline: data.headline,
    p_summary: data.summary,
    p_contact_visibility: data.contactVisibility,
    p_skills: data.skills,
    p_rank: data.rank,
    p_current_company: data.currentCompany,
    p_current_vessel: data.currentVessel,
    p_sailing_experience_years: data.sailingExperienceYears,
    p_vessel_types: data.vesselTypes,
    p_trading_areas: data.tradingAreas,
    p_shore_career_preference: data.shoreCareerPreference,
    p_availability: data.availability,
  })

  if (error?.code === '23505') {
    return failureState(previousState, formData, {
      fieldErrors: { slug: ['That profile address is already in use.'] },
    })
  }
  if (error) {
    return failureState(previousState, formData, {
      error: 'We could not save your profile. Your entries are still here; please try again.',
    })
  }

  redirect(data.profileType === 'company' ? '/company/setup' : '/home')
}

'use server'

import { revalidatePath } from 'next/cache'
import { z } from 'zod'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { PERSONAS, PROFILE_INTENTS, type Persona, type ProfileIntent } from '@/features/profiles/persona'
import { legacyOrganizationConversionRepository } from './legacy-conversion-repository'

const intentsSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return value
    if (typeof value !== 'string' || !value.trim()) return []
    try {
      return JSON.parse(value) as unknown
    } catch {
      return []
    }
  },
  z.array(z.enum(PROFILE_INTENTS))
    .min(1, 'Choose at least one thing you want to do on Sea N Shore.')
    .max(PROFILE_INTENTS.length),
).transform((values) => [...new Set(values)] as ProfileIntent[])

const conversionSchema = z.object({
  fullName: z.string().trim().min(2, 'Add your full name.').max(160, 'Keep your full name to 160 characters or fewer.'),
  persona: z.enum(PERSONAS, { error: 'Choose the option that best describes you.' }),
  profileIntents: intentsSchema,
  headline: z.string().trim().min(2, 'Add your personal role or headline.').max(160, 'Keep your role or headline to 160 characters or fewer.'),
  strategy: z.enum(['existing', 'create']),
  companyId: z.preprocess(
    (value) => typeof value === 'string' && value.trim() ? value.trim() : null,
    z.string().uuid().nullable(),
  ),
  newOrganizationName: z.preprocess(
    (value) => typeof value === 'string' && value.trim() ? value.trim() : null,
    z.string().min(2, 'Add the organization name.').max(160, 'Keep the organization name to 160 characters or fewer.').nullable(),
  ),
}).superRefine((value, context) => {
  if (value.strategy === 'existing' && !value.companyId) {
    context.addIssue({
      code: 'custom',
      path: ['companyId'],
      message: 'Choose an organization where you already have Owner or Administrator access.',
    })
  }
  if (value.strategy === 'create' && !value.newOrganizationName) {
    context.addIssue({
      code: 'custom',
      path: ['newOrganizationName'],
      message: 'Add the organization name before creating the workspace.',
    })
  }
})

export type LegacyOrganizationConversionActionState = {
  ok?: boolean
  companyId?: string
  error?: string
  fieldErrors?: Record<string, string[] | undefined>
  values?: {
    fullName?: string
    persona?: Persona
    profileIntents?: string
    headline?: string
    strategy?: 'existing' | 'create'
    companyId?: string
    newOrganizationName?: string
  }
}

function valuesFrom(formData: FormData): LegacyOrganizationConversionActionState['values'] {
  const text = (name: string) => {
    const value = formData.get(name)
    return typeof value === 'string' ? value : undefined
  }
  const personaValue = text('persona')
  const strategyValue = text('strategy')

  return {
    fullName: text('fullName'),
    persona: PERSONAS.includes(personaValue as Persona) ? personaValue as Persona : undefined,
    profileIntents: text('profileIntents'),
    headline: text('headline'),
    strategy: strategyValue === 'existing' || strategyValue === 'create' ? strategyValue : undefined,
    companyId: text('companyId'),
    newOrganizationName: text('newOrganizationName'),
  }
}

export async function completeLegacyOrganizationConversion(
  _previousState: LegacyOrganizationConversionActionState,
  formData: FormData,
): Promise<LegacyOrganizationConversionActionState> {
  const preserved = valuesFrom(formData)
  const parsed = conversionSchema.safeParse(Object.fromEntries(formData.entries()))

  if (!parsed.success) {
    return {
      ok: false,
      error: 'Please correct the highlighted information and try again.',
      fieldErrors: parsed.error.flatten().fieldErrors,
      values: preserved,
    }
  }

  try {
    const user = await requireAwsUser()
    const result = await legacyOrganizationConversionRepository.completeConversion(user.id, {
      fullName: parsed.data.fullName,
      persona: parsed.data.persona,
      profileIntents: parsed.data.profileIntents,
      headline: parsed.data.headline,
      strategy: parsed.data.strategy,
      companyId: parsed.data.companyId,
      newOrganizationName: parsed.data.newOrganizationName,
    })

    revalidatePath('/home')
    revalidatePath('/profile')
    revalidatePath('/settings')
    revalidatePath('/hiring/organization')
    return { ok: true, companyId: result.companyId }
  } catch (error) {
    const code = error instanceof Error ? error.message : ''

    if (code === 'legacy_company_already_exists') {
      return {
        ok: false,
        error: 'An organization with this name already exists. Use Claim Existing Organization, request Administrator access, then return here to finish conversion.',
        values: preserved,
      }
    }
    if (code === 'legacy_company_admin_required') {
      return {
        ok: false,
        error: 'Owner or Administrator access is required to link this organization. Request Administrator access first, then return here.',
        values: preserved,
      }
    }
    if (code === 'legacy_conversion_completed') {
      return { ok: true }
    }
    if (code === 'legacy_conversion_not_required') {
      return { ok: false, error: 'This account does not require legacy organization conversion.' }
    }
    if (code === 'legacy_company_create_failed') {
      return { ok: false, error: 'The organization workspace could not be created. Please try again.', values: preserved }
    }
    if (/authentication required/i.test(code)) {
      return { ok: false, error: 'Your session may have expired. Sign in again and retry.', values: preserved }
    }

    return {
      ok: false,
      error: 'We could not complete the account conversion. Your entries are still here; please try again.',
      values: preserved,
    }
  }
}

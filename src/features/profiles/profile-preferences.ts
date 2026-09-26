import { z } from 'zod'
import {
  legacyProfileTypeForPersona,
  PERSONAS,
  PROFILE_INTENTS,
  personaUsesProfessionalCompany,
  type Persona,
  type ProfileIntent,
} from './persona'

function optionalText(maximum: number) {
  return z.preprocess(
    (value) => {
      if (typeof value !== 'string') return undefined
      const normalized = value.trim()
      return normalized || undefined
    },
    z.string().max(maximum).optional(),
  )
}

const intentsSchema = z.preprocess(
  (value) => {
    if (Array.isArray(value)) return value
    if (typeof value !== 'string' || value.trim() === '') return []
    try {
      return JSON.parse(value) as unknown
    } catch {
      return value.split(',')
    }
  },
  z.array(z.enum(PROFILE_INTENTS))
    .min(1, 'Choose at least one thing you want to do on Sea N Shore.')
    .max(PROFILE_INTENTS.length),
).transform((values) => [...new Set(values)] as ProfileIntent[])

const rawProfilePreferencesSchema = z.object({
  persona: z.enum(PERSONAS, { error: 'Choose the option that best describes you.' }),
  profileIntents: intentsSchema,
  currentCompany: optionalText(160),
  specialization: optionalText(500),
  institutionName: optionalText(160),
  familyRelationship: optionalText(80),
  rank: optionalText(100),
})

export const profilePreferencesSchema = z.preprocess((value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  const source = value as Record<string, unknown>
  const persona = PERSONAS.find((entry) => entry === source.persona)
  if (!persona) return source

  return {
    ...source,
    currentCompany: personaUsesProfessionalCompany(persona) ? source.currentCompany : undefined,
    specialization: persona === 'trainer_instructor' ? source.specialization : undefined,
    institutionName: persona === 'student_cadet' ? source.institutionName : undefined,
    familyRelationship: persona === 'seafarer_family' ? source.familyRelationship : undefined,
    rank: persona === 'seafarer' ? source.rank : undefined,
  }
}, rawProfilePreferencesSchema)

export type ProfilePreferencesInput = z.infer<typeof profilePreferencesSchema>

export function profilePreferenceProjection(data: ProfilePreferencesInput) {
  return {
    profileType: legacyProfileTypeForPersona(data.persona),
    persona: data.persona as Persona,
    profileIntents: data.profileIntents,
    communityRelationship: data.persona === 'seafarer_family' ? data.familyRelationship ?? null : null,
    institutionName: data.persona === 'student_cadet' ? data.institutionName ?? null : null,
    specialization: data.persona === 'trainer_instructor' ? data.specialization ?? null : null,
    currentCompany: personaUsesProfessionalCompany(data.persona) ? data.currentCompany ?? null : null,
    rank: data.persona === 'seafarer' ? data.rank ?? null : null,
  }
}

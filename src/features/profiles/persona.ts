import type { ProfileType } from './types'

export const PERSONAS = [
  'seafarer',
  'shore_professional',
  'recruiter_hr',
  'trainer_instructor',
  'student_cadet',
  'seafarer_family',
  'maritime_enthusiast',
  'other',
] as const

export type Persona = (typeof PERSONAS)[number]

export const PROFILE_INTENTS = [
  'find_jobs',
  'hire',
  'learn',
  'teach',
  'attend_events',
  'host_events',
  'network',
  'community',
] as const

export type ProfileIntent = (typeof PROFILE_INTENTS)[number]

export const PERSONA_LABELS: Record<Persona, string> = {
  seafarer: 'Seafarer',
  shore_professional: 'Shore Professional',
  recruiter_hr: 'Recruiter / HR',
  trainer_instructor: 'Trainer / Instructor',
  student_cadet: 'Student / Cadet',
  seafarer_family: 'Seafarer Family',
  maritime_enthusiast: 'Maritime Enthusiast',
  other: 'Other',
}

export const PROFILE_INTENT_LABELS: Record<ProfileIntent, string> = {
  find_jobs: 'Find jobs',
  hire: 'Hire people',
  learn: 'Learn',
  teach: 'Teach',
  attend_events: 'Attend events',
  host_events: 'Host events',
  network: 'Network',
  community: 'Community',
}

export function legacyProfileTypeForPersona(persona: Persona): ProfileType {
  if (persona === 'seafarer') return 'seafarer'
  if (persona === 'recruiter_hr') return 'recruiter'
  if (persona === 'trainer_instructor') return 'trainer'
  return 'maritime_professional'
}

export function defaultHeadlineForPersona(input: {
  persona: Persona
  rank?: string
  headline?: string
  specialization?: string
}) {
  const explicit = input.headline?.trim()
  if (explicit) return explicit

  if (input.persona === 'seafarer' && input.rank?.trim()) return input.rank.trim()
  if (input.persona === 'trainer_instructor' && input.specialization?.trim()) {
    return input.specialization.trim().slice(0, 160)
  }

  return PERSONA_LABELS[input.persona]
}

export function personaUsesProfessionalCompany(persona: Persona) {
  return persona === 'seafarer'
    || persona === 'shore_professional'
    || persona === 'recruiter_hr'
    || persona === 'trainer_instructor'
}

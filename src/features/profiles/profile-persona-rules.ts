import { personaUsesProfessionalCompany, type Persona } from './persona'
import type { ProfileExperienceTrack } from './profile-portfolio-types'
import type { PublicProfile } from './types'

type PersonaSource = Pick<PublicProfile, 'persona' | 'profileType'>

/**
 * The persona a profile edits as. Profiles from before personas existed map from their legacy
 * profile type, the same way the profile type & goals form always did.
 */
export function personaForProfile(profile: PersonaSource): Persona {
  if (profile.persona) return profile.persona
  if (profile.profileType === 'seafarer') return 'seafarer'
  if (profile.profileType === 'recruiter') return 'recruiter_hr'
  if (profile.profileType === 'trainer') return 'trainer_instructor'
  return 'shore_professional'
}

export function isSeafarerProfile(profile: PersonaSource) {
  return profile.persona ? profile.persona === 'seafarer' : profile.profileType === 'seafarer'
}

/** Sea service records (vessel, vessel type, cargo, engine, trading areas) belong to seafarers and cadets. */
export function personaOffersSeaService(persona: Persona) {
  return persona === 'seafarer' || persona === 'student_cadet'
}

export function defaultExperienceTrackForPersona(persona: Persona): ProfileExperienceTrack {
  switch (persona) {
    case 'seafarer':
      return 'sea_service'
    case 'shore_professional':
    case 'recruiter_hr':
      return 'shore_role'
    case 'trainer_instructor':
    case 'student_cadet':
      return 'training'
    default:
      return 'other_maritime'
  }
}

export const EXPERIENCE_TRACK_LABELS: Record<ProfileExperienceTrack, string> = {
  sea_service: 'Sea service',
  shore_role: 'Shore role',
  training: 'Training / education',
  other_maritime: 'Work / other role',
}

/**
 * Experience types offered to a persona. Sea service only for seafarers and cadets, unless the
 * record being edited already is sea service: then it stays, so nothing saved is hidden.
 */
export function experienceTracksForPersona(persona: Persona, currentTrack?: ProfileExperienceTrack | null): ProfileExperienceTrack[] {
  const tracks: ProfileExperienceTrack[] = ['shore_role', 'training', 'other_maritime']
  return personaOffersSeaService(persona) || currentTrack === 'sea_service' ? ['sea_service', ...tracks] : tracks
}

/** Licences & credentials are not asked of maritime enthusiasts or seafarer families. */
export function personaUsesCredentials(persona: Persona) {
  return persona !== 'maritime_enthusiast' && persona !== 'seafarer_family'
}

export type PersonaDetailSaved = {
  rank?: string | null
  currentCompany?: string | null
  hasLinkedOrganization?: boolean
  institutionName?: string | null
  communityRelationship?: string | null
  specialization?: string | null
}

export type PersonaDetailFields = {
  rank: boolean
  company: boolean
  institution: boolean
  relationship: boolean
  specialization: boolean
}

function saved(value: string | null | undefined) {
  return Boolean(value?.trim())
}

/**
 * Which persona detail fields an editor shows: the ones the persona asks for (as onboarding does),
 * plus any value that is already saved, which always stays visible and editable (round 10).
 * Organisation accounts never get organization or rank fields.
 */
export function personaDetailFields(
  persona: Persona,
  values: PersonaDetailSaved,
  options: { organisationAccount?: boolean } = {},
): PersonaDetailFields {
  const organisationAccount = options.organisationAccount === true
  return {
    rank: !organisationAccount && (persona === 'seafarer' || saved(values.rank)),
    company: !organisationAccount && (personaUsesProfessionalCompany(persona) || saved(values.currentCompany) || values.hasLinkedOrganization === true),
    institution: persona === 'student_cadet' || saved(values.institutionName),
    relationship: persona === 'seafarer_family' || saved(values.communityRelationship),
    specialization: persona === 'trainer_instructor' || saved(values.specialization),
  }
}

export function rankFieldLabel(persona: Persona) {
  return persona === 'seafarer' ? 'Current or most recent rank' : 'Rank or role'
}

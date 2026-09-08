import { query as defaultQuery } from '@/lib/db/client'
import {
  credentialVerificationStates,
  profileExperienceTracks,
  type CredentialVerificationState,
  type ProfileCredentialRecord,
  type ProfileExperienceRecord,
  type ProfileExperienceTrack,
  type ProfilePortfolio,
} from './profile-portfolio-types'

type QueryFn = <T extends Record<string, unknown> = Record<string, unknown>>(
  text: string,
  values?: readonly unknown[],
) => Promise<T[]>

type ExperienceRow = {
  id: string
  profile_id: string
  track: string
  title: string
  organization: string | null
  vessel: string | null
  vessel_type: string | null
  location: string | null
  started_on: string | null
  ended_on: string | null
  is_current: boolean
  description: string | null
  cargo_experience: string[] | null
  engine_experience: string[] | null
  trading_areas: string[] | null
  sort_order: number
}

type CredentialRow = {
  id: string
  profile_id: string
  name: string
  issuer: string
  credential_number: string | null
  issued_on: string | null
  expires_on: string | null
  no_expiry: boolean
  verification_state: string
  sort_order: number
}

function experienceTrack(value: string): ProfileExperienceTrack {
  return profileExperienceTracks.includes(value as ProfileExperienceTrack)
    ? (value as ProfileExperienceTrack)
    : 'other_maritime'
}

function credentialVerificationState(value: string): CredentialVerificationState {
  return credentialVerificationStates.includes(value as CredentialVerificationState)
    ? (value as CredentialVerificationState)
    : 'self_reported'
}

function mapExperience(row: ExperienceRow): ProfileExperienceRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    track: experienceTrack(row.track),
    title: row.title,
    organization: row.organization,
    vessel: row.vessel,
    vesselType: row.vessel_type,
    location: row.location,
    startedOn: row.started_on,
    endedOn: row.ended_on,
    isCurrent: row.is_current,
    description: row.description,
    cargoExperience: row.cargo_experience ?? [],
    engineExperience: row.engine_experience ?? [],
    tradingAreas: row.trading_areas ?? [],
    sortOrder: row.sort_order,
  }
}

function mapCredential(row: CredentialRow): ProfileCredentialRecord {
  return {
    id: row.id,
    profileId: row.profile_id,
    name: row.name,
    issuer: row.issuer,
    credentialNumber: row.credential_number,
    issuedOn: row.issued_on,
    expiresOn: row.expires_on,
    noExpiry: row.no_expiry,
    verificationState: credentialVerificationState(row.verification_state),
    sortOrder: row.sort_order,
  }
}

export function createProfilePortfolioRepository({ query = defaultQuery }: { query?: QueryFn } = {}) {
  return {
    async getProfilePortfolio(profileId: string): Promise<ProfilePortfolio> {
      const experiences = await query<ExperienceRow>(
        `select
          id,
          profile_id,
          track,
          title,
          organization,
          vessel,
          vessel_type,
          location,
          started_on::text as started_on,
          ended_on::text as ended_on,
          is_current,
          description,
          cargo_experience,
          engine_experience,
          trading_areas,
          sort_order
        from public.profile_experiences
        where profile_id = $1
        order by is_current desc, started_on desc nulls last, sort_order asc, id asc`,
        [profileId],
      )

      const credentials = await query<CredentialRow>(
        `select
          id,
          profile_id,
          name,
          issuer,
          credential_number,
          issued_on::text as issued_on,
          expires_on::text as expires_on,
          no_expiry,
          verification_state,
          sort_order
        from public.profile_credentials
        where profile_id = $1
        order by sort_order asc, issued_on desc nulls last, id asc`,
        [profileId],
      )

      return {
        experiences: experiences.map(mapExperience),
        credentials: credentials.map(mapCredential),
      }
    },
  }
}

const profilePortfolioRepository = createProfilePortfolioRepository()

export function getProfilePortfolio(profileId: string) {
  return profilePortfolioRepository.getProfilePortfolio(profileId)
}

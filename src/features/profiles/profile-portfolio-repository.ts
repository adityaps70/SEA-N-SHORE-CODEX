import { query as defaultQuery } from '@/lib/db/client'
import type { ProfileExperienceInput } from './profile-portfolio-schemas'
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

type ReturningIdRow = { id: string }

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

function experienceValues(data: ProfileExperienceInput) {
  return [
    data.track,
    data.title,
    data.organization,
    data.vessel,
    data.vesselType,
    data.location,
    data.startedOn,
    data.endedOn,
    data.isCurrent,
    data.description,
    data.cargoExperience,
    data.engineExperience,
    data.tradingAreas,
  ] as const
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

    async createProfileExperience(profileId: string, data: ProfileExperienceInput): Promise<string> {
      const rows = await query<ReturningIdRow>(
        `insert into public.profile_experiences (
          profile_id, track, title, organization, vessel, vessel_type, location,
          started_on, ended_on, is_current, description, cargo_experience,
          engine_experience, trading_areas, updated_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7,
          $8::date, $9::date, $10, $11, $12::text[],
          $13::text[], $14::text[], now()
        )
        returning id`,
        [profileId, ...experienceValues(data)],
      )
      const id = rows[0]?.id
      if (!id) throw new Error('profile_experience_create_failed')
      return id
    },

    async updateProfileExperience(profileId: string, experienceId: string, data: ProfileExperienceInput): Promise<boolean> {
      const rows = await query<ReturningIdRow>(
        `update public.profile_experiences
         set track = $3,
             title = $4,
             organization = $5,
             vessel = $6,
             vessel_type = $7,
             location = $8,
             started_on = $9::date,
             ended_on = $10::date,
             is_current = $11,
             description = $12,
             cargo_experience = $13::text[],
             engine_experience = $14::text[],
             trading_areas = $15::text[],
             updated_at = now()
         where id = $1
           and profile_id = $2
         returning id`,
        [experienceId, profileId, ...experienceValues(data)],
      )
      return rows[0]?.id === experienceId
    },

    async deleteProfileExperience(profileId: string, experienceId: string): Promise<boolean> {
      const rows = await query<ReturningIdRow>(
        `delete from public.profile_experiences
         where id = $1
           and profile_id = $2
         returning id`,
        [experienceId, profileId],
      )
      return rows[0]?.id === experienceId
    },
  }
}

const profilePortfolioRepository = createProfilePortfolioRepository()

export function getProfilePortfolio(profileId: string) {
  return profilePortfolioRepository.getProfilePortfolio(profileId)
}

export function createProfileExperienceRecord(profileId: string, data: ProfileExperienceInput) {
  return profilePortfolioRepository.createProfileExperience(profileId, data)
}

export function updateProfileExperienceRecord(profileId: string, experienceId: string, data: ProfileExperienceInput) {
  return profilePortfolioRepository.updateProfileExperience(profileId, experienceId, data)
}

export function deleteProfileExperienceRecord(profileId: string, experienceId: string) {
  return profilePortfolioRepository.deleteProfileExperience(profileId, experienceId)
}

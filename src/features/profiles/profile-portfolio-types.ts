export const profileExperienceTracks = [
  'sea_service',
  'shore_role',
  'training',
  'other_maritime',
] as const

export type ProfileExperienceTrack = (typeof profileExperienceTracks)[number]

export const credentialVerificationStates = [
  'self_reported',
  'pending',
  'verified',
  'rejected',
] as const

export type CredentialVerificationState = (typeof credentialVerificationStates)[number]

export type ProfileExperienceRecord = {
  id: string
  profileId: string
  track: ProfileExperienceTrack
  title: string
  organization: string | null
  vessel: string | null
  vesselType: string | null
  location: string | null
  startedOn: string | null
  endedOn: string | null
  isCurrent: boolean
  description: string | null
  cargoExperience: string[]
  engineExperience: string[]
  tradingAreas: string[]
  sortOrder: number
}

export type ProfileCredentialRecord = {
  id: string
  profileId: string
  name: string
  issuer: string
  credentialNumber: string | null
  issuedOn: string | null
  expiresOn: string | null
  noExpiry: boolean
  verificationState: CredentialVerificationState
  sortOrder: number
}

export type ProfilePortfolio = {
  experiences: ProfileExperienceRecord[]
  credentials: ProfileCredentialRecord[]
}

export const PROFILE_TYPES = [
  'seafarer',
  'maritime_professional',
  'company',
  'trainer',
  'mentor',
  'recruiter',
  'service_provider',
] as const

export type ProfileType = (typeof PROFILE_TYPES)[number]
export type ContactVisibility = 'private' | 'members' | 'public'

export type PublicProfile = {
  id: string
  slug: string
  profileType: ProfileType
  fullName: string
  avatarPath: string | null
  location: string | null
  headline: string | null
  summary: string | null
  rank: string | null
  currentCompany: string | null
  currentVessel: string | null
  sailingExperienceYears: number | null
  vesselTypes: string[]
  tradingAreas: string[]
  shoreCareerPreference: boolean
  availability: string | null
  skills: string[]
}

export type OwnProfile = PublicProfile & {
  contactVisibility: ContactVisibility
  onboardingCompletedAt: string
}

export type PublicProfileRow = {
  id: string
  slug: string
  profile_type: ProfileType
  full_name: string
  avatar_path: string | null
  location: string | null
  headline: string | null
  summary: string | null
  maritime_profiles: {
    rank: string | null
    current_company: string | null
    current_vessel: string | null
    sailing_experience_years: number | null
    vessel_types: string[]
    trading_areas: string[]
    shore_career_preference: boolean
    availability: string | null
  } | null
  profile_skills: Array<{ skill: string }>
}

export type OwnProfileRow = PublicProfileRow & {
  contact_visibility: ContactVisibility
  onboarding_completed_at: string | null
}

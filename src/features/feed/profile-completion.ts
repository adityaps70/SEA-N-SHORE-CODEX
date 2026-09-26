import type { OwnProfile } from '@/features/profiles/types'

export type ProfilePortfolioCompletion = {
  experienceCount: number
  credentialCount: number
}

export function calculateProfileCompletion(
  profile: OwnProfile,
  portfolio: ProfilePortfolioCompletion = { experienceCount: 0, credentialCount: 0 },
): number {
  const generic = [
    Boolean(profile.fullName.trim()),
    Boolean(profile.headline?.trim()),
    Boolean(profile.summary?.trim()),
    Boolean(profile.location?.trim()),
    profile.skills.length > 0,
  ]

  let checks = generic

  if (profile.persona) {
    if (profile.persona === 'seafarer') {
      checks = [
        ...generic,
        Boolean(profile.rank?.trim()),
        Boolean(profile.currentCompany?.trim()),
        profile.sailingExperienceYears !== null,
        portfolio.experienceCount > 0,
        portfolio.credentialCount > 0,
      ]
    } else if (profile.persona === 'shore_professional' || profile.persona === 'recruiter_hr') {
      checks = [...generic, Boolean(profile.currentCompany?.trim())]
    } else if (profile.persona === 'trainer_instructor') {
      checks = [
        ...generic,
        Boolean(profile.currentCompany?.trim()),
        Boolean(profile.specialization?.trim()),
      ]
    } else if (profile.persona === 'student_cadet') {
      checks = [...generic, Boolean(profile.institutionName?.trim())]
    } else if (profile.persona === 'seafarer_family') {
      checks = [...generic, Boolean(profile.communityRelationship?.trim())]
    }
  } else if (profile.profileType === 'seafarer' || profile.profileType === 'maritime_professional') {
    checks = [
      ...generic,
      Boolean(profile.rank?.trim()),
      Boolean(profile.currentCompany?.trim()),
      profile.sailingExperienceYears !== null,
      portfolio.experienceCount > 0,
      portfolio.credentialCount > 0,
    ]
  }

  return Math.round((checks.filter(Boolean).length / checks.length) * 100)
}

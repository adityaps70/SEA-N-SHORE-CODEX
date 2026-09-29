import type { OwnProfile } from '@/features/profiles/types'

export type ProfilePortfolioCompletion = {
  experienceCount: number
  credentialCount: number
}

type CompletionCheck = { done: boolean; hint: string }

const EMPTY_PORTFOLIO: ProfilePortfolioCompletion = { experienceCount: 0, credentialCount: 0 }

/** Every item that counts towards profile completeness, in the order members are asked to fill them. */
function completionChecks(profile: OwnProfile, portfolio: ProfilePortfolioCompletion): CompletionCheck[] {
  const generic: CompletionCheck[] = [
    { done: Boolean(profile.fullName.trim()), hint: 'Add your full name so people can find you' },
    { done: Boolean(profile.headline?.trim()), hint: 'Add a headline so people know what you do' },
    { done: Boolean(profile.summary?.trim()), hint: 'Add a short summary about your work' },
    { done: Boolean(profile.location?.trim()), hint: 'Add your location to get relevant matches' },
    { done: profile.skills.length > 0, hint: 'Add your skills to stand out to recruiters' },
  ]
  const company: CompletionCheck = { done: Boolean(profile.currentCompany?.trim()), hint: 'Add your current organization' }
  const seafarer: CompletionCheck[] = [
    ...generic,
    { done: Boolean(profile.rank?.trim()), hint: 'Add your rank to get better job matches' },
    company,
    { done: profile.sailingExperienceYears !== null, hint: 'Add sea service to get better job matches' },
    { done: portfolio.experienceCount > 0, hint: 'Add your experience to build trust' },
    { done: portfolio.credentialCount > 0, hint: 'Add your certificates to get better job matches' },
  ]

  if (profile.persona) {
    switch (profile.persona) {
      case 'seafarer':
        return seafarer
      case 'shore_professional':
      case 'recruiter_hr':
        return [...generic, company]
      case 'trainer_instructor':
        return [...generic, company, { done: Boolean(profile.specialization?.trim()), hint: 'Add your training specialization' }]
      case 'student_cadet':
        return [...generic, { done: Boolean(profile.institutionName?.trim()), hint: 'Add your institution' }]
      case 'seafarer_family':
        return [...generic, { done: Boolean(profile.communityRelationship?.trim()), hint: 'Add how you are connected to the sea' }]
      default:
        return generic
    }
  }
  if (profile.profileType === 'seafarer' || profile.profileType === 'maritime_professional') return seafarer
  return generic
}

export function calculateProfileCompletion(
  profile: OwnProfile,
  portfolio: ProfilePortfolioCompletion = EMPTY_PORTFOLIO,
): number {
  const checks = completionChecks(profile, portfolio)
  return Math.round((checks.filter((check) => check.done).length / checks.length) * 100)
}

/** One-line prompt for the first missing profile item, or null when the profile is complete. */
export function nextProfileCompletionHint(
  profile: OwnProfile,
  portfolio: ProfilePortfolioCompletion = EMPTY_PORTFOLIO,
): string | null {
  return completionChecks(profile, portfolio).find((check) => !check.done)?.hint ?? null
}

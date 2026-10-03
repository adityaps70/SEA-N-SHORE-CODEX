export type PostSignInProfileProgress = {
  onboardingCompletedAt: string | null
}

export type PostSignInDestination = '/home' | '/onboarding'

export function resolvePostSignInDestination(profile: PostSignInProfileProgress): PostSignInDestination {
  return profile.onboardingCompletedAt ? '/home' : '/onboarding'
}

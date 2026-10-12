export type PostSignInProfileProgress = {
  onboardingCompletedAt: string | null
}

import { safeReturnPath } from '@/lib/auth/return-path'

export type PostSignInDestination = '/home' | '/onboarding' | (string & { readonly __returnPath?: never })

/**
 * Home, or onboarding first. Round F: a member who signed in from an auth wall (`?next=`) goes back to
 * that page once onboarding is done; onboarding itself sends them there when they finish.
 */
export function resolvePostSignInDestination(profile: PostSignInProfileProgress, returnPath?: string | null): PostSignInDestination {
  if (!profile.onboardingCompletedAt) return '/onboarding'
  return safeReturnPath(returnPath) ?? '/home'
}

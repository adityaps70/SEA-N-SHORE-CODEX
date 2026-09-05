import { redirect } from 'next/navigation'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { resolvePostSignInDestination, type PostSignInDestination } from '@/features/auth/post-sign-in'
import { getOnboardingProfileFromAurora } from '@/features/profiles/onboarding-repository'

export const dynamic = 'force-dynamic'

type FailureDestination = '/auth/sign-in?error=post-sign-in-session' | '/auth/sign-in?error=post-sign-in-profile'

export default async function PostSignInPage() {
  let destination: PostSignInDestination | FailureDestination

  try {
    const user = await requireAwsUser()
    const profile = await getOnboardingProfileFromAurora(user.id)

    if (!profile) {
      console.error('Post-sign-in profile routing failed', { name: 'ProfileNotFound' })
      destination = '/auth/sign-in?error=post-sign-in-profile'
    } else {
      destination = resolvePostSignInDestination(profile)
    }
  } catch (error) {
    console.error('Post-sign-in session routing failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    })
    destination = '/auth/sign-in?error=post-sign-in-session'
  }

  redirect(destination)
}

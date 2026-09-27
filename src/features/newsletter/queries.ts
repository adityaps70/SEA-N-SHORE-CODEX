import { getVerifiedUser } from '@/features/auth/queries'
import { newsletterRepository, type NewsletterSubscriber } from './repository'
import type { NewsletterViewer } from './service'

/**
 * The signed-in member (if any) and their Cognito-verified email. The email is
 * only ever used to prefill the form and to recognise the member's own address;
 * it never subscribes anyone on its own.
 */
export async function getNewsletterViewer(): Promise<NewsletterViewer> {
  try {
    const user = await getVerifiedUser()
    if (!user) return null
    const verifiedEmail = await newsletterRepository.getVerifiedEmailForProfile(user.id).catch(() => null)
    return { profileId: user.id, verifiedEmail }
  } catch {
    return null
  }
}

export async function getViewerNewsletterState(): Promise<{
  viewer: NewsletterViewer
  subscriber: NewsletterSubscriber | null
  loadFailed: boolean
}> {
  const viewer = await getNewsletterViewer()
  if (!viewer?.verifiedEmail) return { viewer, subscriber: null, loadFailed: false }
  try {
    return { viewer, subscriber: await newsletterRepository.getByEmail(viewer.verifiedEmail), loadFailed: false }
  } catch {
    return { viewer, subscriber: null, loadFailed: true }
  }
}

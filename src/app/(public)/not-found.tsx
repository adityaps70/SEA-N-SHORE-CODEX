import { NotFoundView } from '@/components/feedback/not-found-view'

/** Member profiles and certificates that do not exist or are no longer public. */
export default function PublicNotFound() {
  return (
    <NotFoundView
      eyebrow="Not available"
      title="This profile or certificate is not available."
      body="The member may have changed their username, made their profile private, or the certificate link may be incorrect. Ask the person for an up-to-date link."
      primary={{ href: '/', label: 'Go to the home page' }}
      links={[{ href: '/auth/sign-in', label: 'Sign in' }]}
    />
  )
}

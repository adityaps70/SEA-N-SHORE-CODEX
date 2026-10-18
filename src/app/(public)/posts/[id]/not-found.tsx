import { NOT_FOUND_METADATA, NotFoundView } from '@/components/feedback/not-found-view'

// Round H (H5): "Page not found · Sea N Shore", noindex.
export const metadata = NOT_FOUND_METADATA

/** A post that was deleted, removed, or never existed (round F: signed in or not, never an error page). */
export default function PostNotFound() {
  return (
    <NotFoundView
      eyebrow="Not available"
      title="This post is no longer available."
      body="Its author may have deleted it, or the link may be out of date."
      primary={{ href: '/', label: 'Go to Sea N Shore' }}
      links={[{ href: '/auth/sign-in', label: 'Sign in' }]}
    />
  )
}

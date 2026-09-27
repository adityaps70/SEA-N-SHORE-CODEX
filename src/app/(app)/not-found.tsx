import { NotFoundView } from '@/components/feedback/not-found-view'

/** Shown inside the signed-in shell when a post, job, event, course or profile no longer exists. */
export default function AppNotFound() {
  return (
    <NotFoundView
      eyebrow="Not available"
      title="We could not find what you were looking for."
      body="It may have been removed, made private, or the link may be out of date. Nothing on your account has changed."
      landmark={false}
      primary={{ href: '/home', label: 'Go to Home' }}
      links={[
        { href: '/search', label: 'Search Sea N Shore' },
        { href: '/help', label: 'Get help' },
      ]}
    />
  )
}

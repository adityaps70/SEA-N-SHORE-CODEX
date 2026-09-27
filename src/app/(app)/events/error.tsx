'use client'

import { RouteErrorView } from '@/components/feedback/route-error-view'

/** Events pages: the shared error view, with a way back to Events. */
export default function EventsError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string }
  retry?: () => void
  reset?: () => void
}) {
  return <RouteErrorView error={error} retry={() => (retry ?? reset)?.()} homeHref="/home" homeLabel="Go to Home" compact landmark={false} />
}

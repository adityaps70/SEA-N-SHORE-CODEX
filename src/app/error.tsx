'use client'

import { RouteErrorView } from '@/components/feedback/route-error-view'

/** Last-resort boundary for anything below the root layout (outside the route groups' own boundaries). */
export default function RootRouteError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string }
  retry?: () => void
  reset?: () => void
}) {
  return <RouteErrorView error={error} retry={() => (retry ?? reset)?.()} homeHref="/" homeLabel="Go to the home page" />
}

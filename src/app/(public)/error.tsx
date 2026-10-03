'use client'

import { RouteErrorView } from '@/components/feedback/route-error-view'

/** Public profiles and certificates. */
export default function PublicRouteError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string }
  retry?: () => void
  reset?: () => void
}) {
  return <RouteErrorView error={error} retry={() => (retry ?? reset)?.()} homeHref="/" homeLabel="Go to the home page" compact />
}

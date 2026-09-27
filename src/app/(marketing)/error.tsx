'use client'

import { RouteErrorView } from '@/components/feedback/route-error-view'

/** Landing, legal and newsletter pages. */
export default function MarketingRouteError({
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

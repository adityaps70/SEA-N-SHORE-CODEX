'use client'

import { RouteErrorView } from '@/components/feedback/route-error-view'

/** Signed-in pages: the header and bottom navigation stay visible so members can move on. */
export default function AppRouteError({
  error,
  retry,
  reset,
}: {
  error: Error & { digest?: string }
  retry?: () => void
  reset?: () => void
}) {
  return <RouteErrorView error={error} retry={() => (retry ?? reset)?.()} compact landmark={false} />
}

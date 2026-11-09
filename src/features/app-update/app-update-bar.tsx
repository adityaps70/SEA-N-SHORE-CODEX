'use client'

import { useEffect, useState } from 'react'
import { APP_UPDATED_EVENT, handleStaleDeployment } from './stale-deployment'

/**
 * Round ARCH (Phase 5 follow-up): mounted once in the root layout. Catches any Server Action call that failed
 * because this tab runs an old build and nobody caught it, and shows the update bar when the tab may not reload
 * by itself (unsaved input, or it already reloaded once for this build). See stale-deployment.ts.
 */
export function AppUpdateBar() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const show = () => setVisible(true)
    const onRejection = (event: PromiseRejectionEvent) => {
      if (handleStaleDeployment(event.reason)) event.preventDefault()
    }
    window.addEventListener(APP_UPDATED_EVENT, show)
    window.addEventListener('unhandledrejection', onRejection)
    return () => {
      window.removeEventListener(APP_UPDATED_EVENT, show)
      window.removeEventListener('unhandledrejection', onRejection)
    }
  }, [])

  if (!visible) return null
  return (
    <div role="status" className="fixed inset-x-0 bottom-4 z-50 flex justify-center px-4 print:hidden">
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="rounded-full bg-navy-900 px-4 py-2 text-sm font-semibold text-white shadow-lg hover:bg-navy-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
      >
        Sea N Shore has been updated, tap to refresh
      </button>
    </div>
  )
}

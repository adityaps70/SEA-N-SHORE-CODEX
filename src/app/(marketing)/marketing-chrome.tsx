'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/** Routes in the marketing group that draw their own header and footer. */
const OWN_CHROME_PATHS = new Set(['/'])

/**
 * Shows the shared public header and footer on every marketing page except the landing
 * page, which has its own full-width header and footer from the approved design.
 */
export function MarketingChrome({ header, footer, children }: { header: ReactNode; footer: ReactNode; children: ReactNode }) {
  const pathname = usePathname()
  if (pathname && OWN_CHROME_PATHS.has(pathname)) return <>{children}</>
  return (
    <div className="min-h-screen bg-mist-50">
      {header}
      {children}
      {footer}
    </div>
  )
}

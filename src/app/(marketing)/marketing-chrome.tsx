'use client'

import { usePathname } from 'next/navigation'
import type { ReactNode } from 'react'

/** Routes in the marketing group that draw their own header and footer for signed-out visitors. */
const OWN_CHROME_PATHS = new Set(['/'])

/**
 * Signed-out visitors only (members get MemberChrome from the layout): shows the shared public
 * header and site footer on every marketing page except the landing page, which has its own
 * full-width header and footer from the approved design.
 */
export function MarketingChrome({ header, footer, children }: { header: ReactNode; footer: ReactNode; children: ReactNode }) {
  const pathname = usePathname()
  if (pathname && OWN_CHROME_PATHS.has(pathname)) return <>{children}</>
  // `group/shell` lets the site footer hide where a right rail shows its own footer.
  return (
    <div className="group/shell min-h-screen bg-mist-50">
      {header}
      {children}
      {footer}
    </div>
  )
}

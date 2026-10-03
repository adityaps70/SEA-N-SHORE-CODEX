'use client'

import { usePathname } from 'next/navigation'
import { NewsletterSignupForm } from './newsletter-signup-form'

/** Compact footer sign-up. Hidden on the newsletter pages, which already show the full form. */
export function NewsletterFooterSignup() {
  const pathname = usePathname()
  if (pathname?.startsWith('/newsletter')) return null
  return (
    <div className="rounded-2xl border border-mist-100 bg-mist-50 p-4">
      <NewsletterSignupForm variant="compact" source="public_footer" />
    </div>
  )
}

'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

/**
 * Requests used to live on the organization page at #requests. Send old links
 * (bookmarks, earlier notifications) to the Requests section of Manage page.
 */
export function LegacyRequestsHashRedirect({ href }: { href: string }) {
  const router = useRouter()
  useEffect(() => {
    if (window.location.hash === '#requests') router.replace(href)
  }, [href, router])
  return null
}

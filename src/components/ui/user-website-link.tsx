import type { ReactNode } from 'react'
import { USER_WEBSITE_REL, userWebsiteHref } from '@/lib/user-website'

/**
 * Round H (H7): a website a member or organization typed in, opened in a new tab with
 * rel="nofollow ugc noopener noreferrer". Shows the plain text when the value is not an http(s) link.
 */
export function UserWebsiteLink({ href, children, className, role, onClick }: {
  href: string
  children: ReactNode
  className?: string
  role?: 'menuitem'
  onClick?: () => void
}) {
  const safe = userWebsiteHref(href)
  if (!safe) return <span className={className}>{children}</span>
  return (
    <a href={safe} target="_blank" rel={USER_WEBSITE_REL} role={role} onClick={onClick} className={className}>
      {children}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  )
}

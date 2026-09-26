'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentProps } from 'react'

type ActiveNavLinkProps = ComponentProps<typeof Link> & {
  activeClassName: string
  /** Match only the exact path (for section roots such as /admin that also prefix every sub-page). */
  exact?: boolean
}

function routeIsActive(pathname: string | null, href: ComponentProps<typeof Link>['href'], exact = false) {
  if (!pathname || typeof href !== 'string') return false
  if (exact || href === '/home') return pathname === href
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function ActiveNavLink({ href, activeClassName, className = '', exact = false, ...props }: ActiveNavLinkProps) {
  const pathname = usePathname()
  const active = routeIsActive(pathname, href, exact)

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`${className} ${active ? activeClassName : ''}`.trim()}
      {...props}
    />
  )
}

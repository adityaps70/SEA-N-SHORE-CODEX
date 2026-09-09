'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { ComponentProps } from 'react'

type ActiveNavLinkProps = ComponentProps<typeof Link> & {
  activeClassName: string
}

function routeIsActive(pathname: string, href: ComponentProps<typeof Link>['href']) {
  if (typeof href !== 'string') return false
  if (href === '/home') return pathname === '/home'
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function ActiveNavLink({ href, activeClassName, className = '', ...props }: ActiveNavLinkProps) {
  const pathname = usePathname()
  const active = routeIsActive(pathname, href)

  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={`${className} ${active ? activeClassName : ''}`.trim()}
      {...props}
    />
  )
}

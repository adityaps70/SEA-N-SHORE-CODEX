'use client'

import NextLink from 'next/link'
// The context itself, not useRouter(): useRouter throws outside the app router (component tests),
// and a missing router should only mean no prefetch.
import { AppRouterContext } from 'next/dist/shared/lib/app-router-context.shared-runtime'
import { forwardRef, useContext, type ComponentProps, type FocusEvent, type MouseEvent, type TouchEvent } from 'react'

/**
 * Round H (H1): a next/link that prefetches only when the member shows intent (hover, focus or touch)
 * and at most once per route per browser session.
 *
 * Next 16 prefetches every Link that scrolls into view, and each dynamic route costs two RSC requests
 * (the route tree, then the segment), each running the app layout's queries. With seven nav links,
 * footer links and every author link in the feed, one Home view made about 99 requests. Pass
 * prefetch explicitly to opt back into the default behaviour.
 */
const prefetched = new Set<string>()

export function resetIntentPrefetchForTests() {
  prefetched.clear()
}

export function intentPrefetchKey(href: ComponentProps<typeof NextLink>['href']) {
  if (typeof href !== 'string') return null
  // Only same-site paths; the hash never changes what is fetched.
  if (!href.startsWith('/') || href.startsWith('//')) return null
  return href.split('#')[0] || null
}

type IntentLinkProps = ComponentProps<typeof NextLink>

export const IntentLink = forwardRef<HTMLAnchorElement, IntentLinkProps>(function IntentLink(
  { prefetch, onMouseEnter, onFocus, onTouchStart, href, ...props },
  ref,
) {
  const router = useContext(AppRouterContext)
  const explicit = prefetch !== undefined

  function prefetchOnce() {
    if (explicit || !router) return
    const key = intentPrefetchKey(href)
    if (!key || prefetched.has(key)) return
    prefetched.add(key)
    try {
      router.prefetch(key)
    } catch {
      // Prefetch is a hint; navigation still works without it.
    }
  }

  return (
    <NextLink
      ref={ref}
      href={href}
      prefetch={explicit ? prefetch : false}
      onMouseEnter={(event: MouseEvent<HTMLAnchorElement>) => {
        prefetchOnce()
        onMouseEnter?.(event)
      }}
      onFocus={(event: FocusEvent<HTMLAnchorElement>) => {
        prefetchOnce()
        onFocus?.(event)
      }}
      onTouchStart={(event: TouchEvent<HTMLAnchorElement>) => {
        prefetchOnce()
        onTouchStart?.(event)
      }}
      {...props}
    />
  )
})

export default IntentLink

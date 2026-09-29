'use client'

import { usePathname } from 'next/navigation'
import { Monitor } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'

export type AdminSectionLink = { href: string; label: string }

/** The admin section a path belongs to: the longest matching section href. */
export function adminSectionFor(pathname: string, sections: readonly AdminSectionLink[]) {
  return [...sections]
    .filter((section) => pathname === section.href || (section.href !== '/admin' && pathname.startsWith(`${section.href}/`)))
    .sort((a, b) => b.href.length - a.href.length)[0] ?? sections.find((section) => section.href === '/admin') ?? null
}

/** Back target on phones: one level up; the Overview goes back to Home. */
export function adminBackHref(pathname: string) {
  if (pathname === '/admin' || !pathname.startsWith('/admin/')) return '/home'
  const parent = pathname.replace(/\/[^/]+\/?$/, '')
  return parent || '/admin'
}

/**
 * Phone admin chrome (round 8): "Admin · <section>" page bar and an amber note that the console
 * is built for a computer. Hidden on md and wider, where the sidebar nav already names the section.
 */
export function AdminMobileBar({ sections }: { sections: readonly AdminSectionLink[] }) {
  const pathname = usePathname() ?? '/admin'
  const section = adminSectionFor(pathname, sections)
  return (
    <>
      <MobilePageBar
        backHref={adminBackHref(pathname)}
        title={section ? `Admin · ${section.label}` : 'Admin'}
        className="!mb-0"
      />
      <div role="note" className="-mx-4 mb-3 flex items-start gap-3 bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900 md:hidden">
        <Monitor aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-amber-800" />
        <p>Admin works best on a computer. Everything still works here.</p>
      </div>
    </>
  )
}

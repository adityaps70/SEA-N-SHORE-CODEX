'use client'

import Link from 'next/link'
import {
  Activity,
  Bookmark,
  BookOpenCheck,
  BriefcaseBusiness,
  CalendarDays,
  CircleHelp,
  Crown,
  GraduationCap,
  MessagesSquare,
  Plus,
  Settings,
  ShieldCheck,
  X,
  type LucideIcon,
} from 'lucide-react'
import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { useSheetScrollLock } from '@/components/ui/mobile-sheet'
import { OrganizationLogo } from '@/features/profiles/components/organization-logo'
import { AccountMenuSignOut, type HeaderOrganization } from './account-menu'
import { FooterSocialIcons, footerBottomLine, footerLinks } from './app-footer'
import { ViewerAvatar, type HeaderViewer } from './viewer-avatar'

export const SIDE_DRAWER_ID = 'phone-side-drawer'

const focusRing = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'
const rowClass = `flex min-h-13 min-w-0 flex-1 items-center gap-4 px-5 text-base font-semibold text-navy-950 hover:bg-mist-50 focus-visible:-outline-offset-2 ${focusRing}`
const iconClass = 'size-6 shrink-0 text-navy-900'
const sectionClass = 'border-t border-mist-100 py-1.5'
const headingClass = 'px-5 pb-1 pt-2.5 text-xs font-bold uppercase tracking-[0.12em] text-muted'
const secondaryLinkClass = `inline-flex min-h-11 shrink-0 items-center rounded-full px-3 text-sm font-semibold text-ocean-700 hover:bg-ocean-50 hover:underline ${focusRing}`

/** Destinations that already have a row in the drawer are left out of its small footer links. */
const DRAWER_ROW_HREFS = new Set(['/jobs', '/learn', '/events', '/community', '/help'])

export function drawerFooterLinks() {
  return footerLinks({ signedIn: true }).filter((link) => !DRAWER_ROW_HREFS.has(link.href))
}

function DrawerRow({ href, icon: Icon, label, iconClassName = iconClass, trailing }: {
  href: string
  icon: LucideIcon
  label: string
  iconClassName?: string
  trailing?: ReactNode
}) {
  const link = (
    <Link href={href} className={rowClass}>
      <Icon aria-hidden="true" className={iconClassName} strokeWidth={1.75} />
      <span className="min-w-0 truncate">{label}</span>
    </Link>
  )
  if (!trailing) return <li className="flex">{link}</li>
  return (
    <li className="flex items-center pr-3">
      {link}
      {trailing}
    </li>
  )
}

function focusableIn(root: HTMLElement | null) {
  return Array.from(
    root?.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])') ?? [],
  )
}

export type SideDrawerProps = {
  open: boolean
  onClose(): void
  viewer: HeaderViewer
  organizations?: HeaderOrganization[]
  organizationCount?: number
  canAccessAdmin?: boolean
}

/**
 * Phone side drawer (round 8), opened from the profile photo in the phone top bar. It replaces the
 * phone account menu and carries everything that is not a bottom tab: Learn, Events, Community,
 * Saved posts, My Activities, the member's organizations, work tools, plan, Settings, Help,
 * Sign out and the footer links. Rendered below `md` only.
 */
export function SideDrawer({
  open,
  onClose,
  viewer,
  organizations = [],
  organizationCount = organizations.length,
  canAccessAdmin = false,
}: SideDrawerProps) {
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement | null>(null)
  const closeRef = useRef<HTMLButtonElement | null>(null)
  const onCloseRef = useRef(onClose)
  useSheetScrollLock(open)

  useEffect(() => {
    onCloseRef.current = onClose
  })

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    closeRef.current?.focus()
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === 'Escape') onCloseRef.current()
    }
    // The drawer is a phone surface: close it if the window grows to the desktop layout.
    const desktop = typeof window.matchMedia === 'function' ? window.matchMedia('(min-width: 768px)') : null
    function onDesktop(event: MediaQueryListEvent) {
      if (event.matches) onCloseRef.current()
    }
    window.addEventListener('keydown', onKey)
    desktop?.addEventListener?.('change', onDesktop)
    return () => {
      window.removeEventListener('keydown', onKey)
      desktop?.removeEventListener?.('change', onDesktop)
      previous?.focus?.()
    }
  }, [open])

  if (!open) return null

  // Keep Tab inside the drawer while it is open.
  function onPanelKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Tab') return
    const entries = focusableIn(panelRef.current)
    if (!entries.length) return
    const first = entries[0]
    const last = entries[entries.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  // Choosing any link closes the drawer, including a link to the page already open.
  function onPanelClick(event: MouseEvent<HTMLDivElement>) {
    if (event.target instanceof Element && event.target.closest('a[href]')) onClose()
  }

  const completion = viewer.profileCompletion
  const showCompletion = typeof completion === 'number' && completion < 100
  const subline = [viewer.organization, viewer.location].filter(Boolean).join(' · ')
  const moreOrganizations = organizationCount > organizations.length

  return (
    <div className="fixed inset-0 z-[70] md:hidden">
      <div aria-hidden="true" onClick={onClose} className="absolute inset-0 bg-navy-950/50 motion-safe:animate-[sheet-fade_200ms_ease-out]" />
      <div
        ref={panelRef}
        id={SIDE_DRAWER_ID}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onPanelKeyDown}
        onClick={onPanelClick}
        className="absolute inset-y-0 left-0 flex w-[84%] max-w-80 flex-col overflow-y-auto overscroll-contain bg-white pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] shadow-[12px_0_32px_rgb(7_27_45/0.18)] motion-safe:animate-[drawer-in_250ms_cubic-bezier(0.22,1,0.36,1)]"
      >
        <div className="relative px-5 pb-4 pt-5">
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Close menu"
            className={`absolute right-2 top-2 grid size-11 cursor-pointer place-items-center rounded-full text-navy-700 hover:bg-mist-50 ${focusRing}`}
          >
            <X aria-hidden="true" className="size-5" />
          </button>
          <Link href="/profile" aria-label={`${viewer.name}, view profile`} className={`inline-block rounded-full ${focusRing}`}>
            <ViewerAvatar viewer={viewer} className="size-14 text-base" />
          </Link>
          <h2 id={titleId} className="mt-3 pr-8 text-xl font-bold leading-tight text-navy-950">{viewer.name}</h2>
          {viewer.headline ? <p className="mt-1 line-clamp-2 text-sm text-ink">{viewer.headline}</p> : null}
          {subline ? <p className="mt-0.5 truncate text-sm text-muted">{subline}</p> : null}
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
            <Link href="/profile" className={`inline-flex min-h-11 items-center rounded text-[15px] font-bold text-ocean-700 hover:underline ${focusRing}`}>
              View profile
            </Link>
            {showCompletion ? (
              <Link
                href="/profile/edit"
                className={`inline-flex min-h-9 items-center rounded-full border border-ocean-700 px-3 text-sm font-semibold text-ocean-700 hover:bg-ocean-50 ${focusRing}`}
              >
                Complete profile · {completion}%
              </Link>
            ) : null}
          </div>
        </div>

        <nav aria-label="Side menu" className="flex-1">
          <ul className={sectionClass}>
            <DrawerRow
              href="/learn"
              icon={BookOpenCheck}
              label="Learn"
              trailing={<Link href="/learn/my-learning" className={secondaryLinkClass}>My learning</Link>}
            />
            <DrawerRow href="/events" icon={CalendarDays} label="Events" />
            <DrawerRow href="/community" icon={MessagesSquare} label="Community" />
            <DrawerRow href="/saved" icon={Bookmark} label="Saved posts" />
            <DrawerRow href="/activities" icon={Activity} label="My Activities" />
          </ul>

          <section aria-labelledby={`${titleId}-organizations`} className={sectionClass}>
            <h3 id={`${titleId}-organizations`} className={headingClass}>Your organizations</h3>
            <ul>
              {organizations.map((organization) => (
                <li key={organization.id} className="flex items-center gap-2 pr-3">
                  <Link
                    href={`/organizations/${organization.slug}`}
                    className={`flex min-h-13 min-w-0 flex-1 items-center gap-3 px-5 text-[15px] font-semibold text-navy-950 hover:bg-mist-50 focus-visible:-outline-offset-2 ${focusRing}`}
                  >
                    <OrganizationLogo logoUrl={organization.logoUrl} size="sm" />
                    <span className="min-w-0 line-clamp-2 break-words">{organization.name}</span>
                  </Link>
                  {organization.canManage ? (
                    <Link
                      href={`/organizations/${organization.slug}/manage`}
                      aria-label={`Manage ${organization.name}`}
                      className={`inline-flex min-h-9 shrink-0 items-center rounded-full border border-mist-300 px-3 text-sm font-semibold text-ocean-700 hover:border-ocean-700 hover:bg-ocean-50 ${focusRing}`}
                    >
                      Manage
                    </Link>
                  ) : null}
                </li>
              ))}
              <li className="flex">
                <Link href="/organizations#your-pages" className={`flex min-h-11 flex-1 items-center px-5 text-[15px] font-semibold text-ocean-700 hover:underline ${focusRing}`}>
                  {organizations.length
                    ? moreOrganizations ? `See all ${organizationCount} organizations` : 'See all organizations'
                    : 'Browse organizations'}
                </Link>
              </li>
              <li className="flex">
                <Link
                  href="/organizations?register=1#update-application"
                  className={`flex min-h-11 flex-1 items-center gap-4 px-5 text-[15px] font-semibold text-ocean-700 hover:underline ${focusRing}`}
                >
                  <Plus aria-hidden="true" className="size-6 shrink-0" strokeWidth={1.75} />
                  Create an organization page
                </Link>
              </li>
            </ul>
          </section>

          <section aria-labelledby={`${titleId}-tools`} className={sectionClass}>
            <h3 id={`${titleId}-tools`} className={headingClass}>Work tools</h3>
            <ul>
              <DrawerRow href="/hiring" icon={BriefcaseBusiness} label="Hiring" />
              <DrawerRow href="/learn/teach" icon={GraduationCap} label="Teach on Sea N Shore" />
              {canAccessAdmin ? <DrawerRow href="/admin" icon={ShieldCheck} label="Admin" /> : null}
            </ul>
          </section>

          <ul className={sectionClass}>
            <DrawerRow href="/settings/billing" icon={Crown} iconClassName="size-6 shrink-0 text-amber-600" label="Plans & billing" />
          </ul>

          <ul className={sectionClass}>
            <DrawerRow href="/settings" icon={Settings} label="Settings" />
            <DrawerRow href="/help" icon={CircleHelp} label="Help" />
            <li><AccountMenuSignOut variant="drawer" /></li>
          </ul>
        </nav>

        <div className="border-t border-mist-100 px-5 pb-5 pt-3 text-xs text-muted">
          <nav aria-label="About Sea N Shore">
            <ul className="flex flex-wrap gap-x-3 gap-y-0.5">
              {drawerFooterLinks().map((link) => (
                <li key={link.href}>
                  <Link href={link.href} className={`inline-flex min-h-8 items-center hover:text-ocean-700 hover:underline ${focusRing}`}>
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <FooterSocialIcons className="-ml-2 mt-2" />
          <p className="mt-3 leading-5">{footerBottomLine()}</p>
        </div>
      </div>
    </div>
  )
}

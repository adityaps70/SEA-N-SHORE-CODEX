'use client'

import { Bell, BriefcaseBusiness, House, SquarePlus, UsersRound, type LucideIcon } from 'lucide-react'
import { usePathname } from 'next/navigation'
import { useCallback, useEffect, useState } from 'react'
import { ActiveNavLink } from './active-nav-link'
import { CreateSheet } from './create-sheet'
import { isPhoneFullScreenRoute } from './mobile-routes'

/**
 * Phone bottom tabs (round 8): Home · Network · Post · Notifications · Jobs. Post opens the
 * Create sheet. Messages and search are in the phone top bar; Learn, Events, Community, Saved
 * posts, organizations, Settings and the rest are in the side drawer behind the profile photo.
 */
type TabLink = { href: string; label: string; accessibleLabel: string; icon: LucideIcon; badge?: 'network' | 'notifications' }

const leftTabs: TabLink[] = [
  { href: '/home', label: 'Home', accessibleLabel: 'Home', icon: House },
  { href: '/network', label: 'Network', accessibleLabel: 'My Network', icon: UsersRound, badge: 'network' },
]
const rightTabs: TabLink[] = [
  { href: '/notifications', label: 'Notifications', accessibleLabel: 'Notifications', icon: Bell, badge: 'notifications' },
  { href: '/jobs', label: 'Jobs', accessibleLabel: 'Jobs', icon: BriefcaseBusiness },
]

const tabClass = 'group/tab relative flex min-h-16 min-w-0 cursor-pointer flex-col items-center justify-center gap-1 border-t-2 border-transparent px-0.5 text-center text-[11px] font-medium leading-tight text-muted focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500'
const activeTabClass = 'border-navy-950 font-bold text-navy-950'
const iconClass = 'size-6 shrink-0 stroke-[1.75] group-aria-[current=page]/tab:stroke-[2.5]'
const badgeClass = 'absolute left-1/2 top-1.5 ml-1.5 inline-flex min-w-5 items-center justify-center rounded-full bg-ocean-700 px-1 text-[10px] font-bold leading-5 text-white ring-2 ring-white'

/** "9+" once a count passes nine, as on the notification bell. */
export function tabBadgeText(count: number) {
  return count > 9 ? '9+' : String(count)
}

const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'])

/** True when focus is in a field that opens the on-screen keyboard. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLTextAreaElement) return true
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type)
  if (target.isContentEditable) return true
  const editable = target.closest('[contenteditable]')
  return Boolean(editable && editable.getAttribute('contenteditable') !== 'false')
}

/** Hides the tab bar while the phone keyboard is up, so it never sits on top of what is being typed. */
function useTyping() {
  const [typing, setTyping] = useState(false)
  useEffect(() => {
    function onFocusIn(event: FocusEvent) {
      setTyping(isTypingTarget(event.target))
    }
    function onFocusOut(event: FocusEvent) {
      setTyping(isTypingTarget(event.relatedTarget))
    }
    document.addEventListener('focusin', onFocusIn)
    document.addEventListener('focusout', onFocusOut)
    return () => {
      document.removeEventListener('focusin', onFocusIn)
      document.removeEventListener('focusout', onFocusOut)
    }
  }, [])
  return typing
}

export function MobileNav({
  notificationUnreadCount = 0,
  pendingConnectionRequestCount = 0,
}: {
  notificationUnreadCount?: number
  pendingConnectionRequestCount?: number
}) {
  const pathname = usePathname()
  const typing = useTyping()
  // The Create sheet remembers the page it was opened on, so navigating away closes it.
  const [createOpenedOn, setCreateOpenedOn] = useState<{ pathname: string | null } | null>(null)
  const createOpen = createOpenedOn !== null && createOpenedOn.pathname === pathname
  const closeCreate = useCallback(() => setCreateOpenedOn(null), [])
  const fullScreen = pathname ? isPhoneFullScreenRoute(pathname) : false

  function tab({ href, label, accessibleLabel, icon: Icon, badge }: TabLink) {
    const count = badge === 'network' ? pendingConnectionRequestCount : badge === 'notifications' ? notificationUnreadCount : 0
    const countLabel = badge === 'network'
      ? `${count} pending connection ${count === 1 ? 'request' : 'requests'}`
      : `${count} unread`
    return (
      <ActiveNavLink
        key={href}
        href={href}
        aria-label={count > 0 ? `${accessibleLabel}, ${countLabel}` : accessibleLabel}
        activeClassName={activeTabClass}
        className={tabClass}
      >
        <Icon aria-hidden="true" className={iconClass} />
        {count > 0 ? <span aria-hidden="true" data-testid={`${badge}-tab-badge`} className={badgeClass}>{tabBadgeText(count)}</span> : null}
        <span className="max-w-full truncate">{label}</span>
      </ActiveNavLink>
    )
  }

  return (
    <>
      <nav
        aria-label="Primary"
        // Full-screen routes (composer, chat, course player, editors) have no tab bar; the app
        // shell drops its bottom padding for it via `has-[[data-phone-tabbar=off]]`.
        data-phone-tabbar={fullScreen ? 'off' : typing ? 'typing' : 'on'}
        hidden={fullScreen || typing}
        className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-mist-100 bg-white pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        {leftTabs.map(tab)}
        <button
          type="button"
          aria-haspopup="dialog"
          aria-expanded={createOpen}
          onClick={() => setCreateOpenedOn({ pathname })}
          className={tabClass}
        >
          <SquarePlus aria-hidden="true" className={iconClass} />
          <span className="max-w-full truncate">Post</span>
        </button>
        {rightTabs.map(tab)}
      </nav>
      <CreateSheet open={createOpen} onClose={closeCreate} />
    </>
  )
}

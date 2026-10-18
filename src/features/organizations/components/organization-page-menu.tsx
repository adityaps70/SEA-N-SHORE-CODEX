'use client'

import { useCallback, useEffect, useId, useRef, useState, useTransition, type KeyboardEvent } from 'react'
import { useRouter } from 'next/navigation'
import { USER_WEBSITE_REL, userWebsiteHref } from '@/lib/user-website'
import { Check, Crown, ExternalLink, Link2, LogOut, MessageCircleMore, MessagesSquare, MoreHorizontal, Share2, UserPlus } from 'lucide-react'
import { ActionMenu, ActionMenuItem, visibleMenuItems } from '@/components/ui/action-menu'
import { startDirectConversationAction } from '@/features/messaging/actions'
import { cn } from '@/lib/cn'
import { ORGANIZATION_ANCHOR_EVENT } from './phone-disclosure'
import { ORGANIZATION_LEAVE_OPEN_EVENT } from './leave-organization'

export type OrganizationMenuLink = { href: string; label: string }

/** Header actions that can also live in the menu (round H, H6). */
export type OrganizationMenuAction = 'website' | 'message' | 'createCommunity' | 'upgrade'

/** Before round H these rows were phone-only: the header showed them as buttons from md up. */
const DEFAULT_PHONE_ONLY: readonly OrganizationMenuAction[] = ['website', 'upgrade']

/**
 * Opens the page's "…" menu from the phone page bar. The bar is a sticky stacking context, so
 * the sheet itself lives with the header menu and the bar button only asks it to open.
 */
export const ORGANIZATION_MENU_OPEN_EVENT = 'sns:organization-menu-open'

/** The "…" button in the phone page bar; it opens the same menu as the header button. */
export function OrganizationPageMenuBarButton({ organizationName }: { organizationName: string }) {
  return (
    <button
      type="button"
      aria-label={`More actions for ${organizationName}`}
      aria-haspopup="menu"
      onClick={() => window.dispatchEvent(new CustomEvent(ORGANIZATION_MENU_OPEN_EVENT))}
      className="grid size-11 cursor-pointer place-items-center rounded-full text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
    >
      <MoreHorizontal aria-hidden="true" className="size-6" />
    </button>
  )
}

/**
 * "More" (⋯) menu on the organization page: copy link, share and join shortcuts, plus the header
 * actions that do not fit beside the primary and secondary buttons. On phones it is a bottom sheet.
 * Rows named in `phoneOnlyItems` are header buttons from md up and show in the menu on phones only.
 */
export function OrganizationPageMenu({
  organizationName,
  pagePath,
  joinLink,
  websiteHref,
  upgradeHref,
  messageProfileId,
  createCommunityHref,
  phoneOnlyItems = DEFAULT_PHONE_ONLY,
  leaveCompanyId,
}: {
  organizationName: string
  /** Path of the public page, e.g. /organizations/oceanic. */
  pagePath: string
  /** "Claim this page", "Request to join" or "See your request", when it applies to the viewer. */
  joinLink?: OrganizationMenuLink | null
  /** The organization's website. */
  websiteHref?: string | null
  /** Plan & billing, for owners and administrators who can upgrade. */
  upgradeHref?: string | null
  /** Round H (H6): "Message" the organization's contact person, when it is not a header button. */
  messageProfileId?: string | null
  /** Round H (H6): "Create a community" for owners and administrators. */
  createCommunityHref?: string | null
  /** Rows that are header buttons from md up (shown in the menu on phones only). */
  phoneOnlyItems?: readonly OrganizationMenuAction[]
  /** Round F: an approved member of this organization sees "Leave organization". */
  leaveCompanyId?: string | null
}) {
  const [open, setOpen] = useState(false)
  // Open towards whichever side has room, so the menu never runs off a phone screen.
  const [alignRight, setAlignRight] = useState(false)
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const [initialFocus, setInitialFocus] = useState<'first' | 'last'>('first')
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  const menuId = useId()
  const router = useRouter()
  const [messaging, startMessaging] = useTransition()

  useEffect(() => {
    function onOpenRequest() {
      setInitialFocus('first')
      setOpen(true)
    }
    window.addEventListener(ORGANIZATION_MENU_OPEN_EVENT, onOpenRequest)
    return () => window.removeEventListener(ORGANIZATION_MENU_OPEN_EVENT, onOpenRequest)
  }, [])

  useEffect(() => {
    if (!status) return
    const timer = window.setTimeout(() => setStatus(null), 4000)
    return () => window.clearTimeout(timer)
  }, [status])

  function pageUrl() {
    return typeof window === 'undefined' ? pagePath : `${window.location.origin}${pagePath}`
  }

  async function copyLink() {
    close()
    triggerRef.current?.focus()
    try {
      if (!navigator.clipboard) throw new Error('clipboard_unavailable')
      await navigator.clipboard.writeText(pageUrl())
      setStatus({ tone: 'success', text: 'Link copied' })
    } catch {
      setStatus({ tone: 'error', text: 'Your browser blocked copying. Copy the link from the address bar instead.' })
    }
  }

  async function share() {
    if (typeof navigator.share !== 'function') {
      await copyLink()
      return
    }
    close()
    triggerRef.current?.focus()
    try {
      await navigator.share({ title: `${organizationName} on Sea N Shore`, url: pageUrl() })
    } catch (error) {
      // Closing the share sheet is not an error.
      if (error instanceof Error && error.name === 'AbortError') return
      setStatus({ tone: 'error', text: 'Sharing is not available here. Use Copy link instead.' })
    }
  }

  /** Same server action as the header's Message button. */
  function message(profileId: string) {
    close()
    triggerRef.current?.focus()
    startMessaging(async () => {
      try {
        const result = await startDirectConversationAction(profileId)
        if (!result.ok) {
          setStatus({ tone: 'error', text: result.error })
          return
        }
        router.push(`/messages/${result.conversationId}`)
      } catch {
        setStatus({ tone: 'error', text: 'We could not open the conversation. Check your connection and try again.' })
      }
    })
  }

  function openMenu() {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) setAlignRight(rect.left + 232 > window.innerWidth)
    setOpen(true)
  }

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const target = event.key === 'ArrowDown' ? 'first' : 'last'
    if (open) {
      const entries = visibleMenuItems(document.getElementById(menuId))
      entries[target === 'first' ? 0 : entries.length - 1]?.focus()
      return
    }
    setInitialFocus(target)
    openMenu()
  }

  const itemClass = 'py-2'
  // Anchors keep the row look of ActionMenuItem; phone-only rows hide from md up.
  const linkItemClass = cn('flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold text-navy-950 transition hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:-outline-offset-2 [&>svg]:size-4 [&>svg]:shrink-0 max-md:min-h-13 max-md:gap-4 max-md:px-4 max-md:text-[15px] max-md:[&>svg]:size-5')
  const rowClass = (action: OrganizationMenuAction, base: string) => (phoneOnlyItems.includes(action) ? `${base} md:hidden` : base)

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`More actions for ${organizationName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className="inline-flex size-10 shrink-0 cursor-pointer items-center justify-center rounded-xl border border-mist-200 bg-white text-navy-950 transition hover:border-navy-300 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 max-md:size-11 max-md:rounded-full"
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>
      <ActionMenu
        open={open}
        onClose={close}
        anchorRef={triggerRef}
        id={menuId}
        label={`More actions for ${organizationName}`}
        align={alignRight ? 'end' : 'start'}
        initialFocus={initialFocus}
        className="w-56 shadow-[var(--shadow-card)]"
      >
        {websiteHref ? (
          <a href={userWebsiteHref(websiteHref) ?? undefined} target="_blank" rel={USER_WEBSITE_REL} role="menuitem" onClick={close} className={rowClass('website', linkItemClass)}>
            <ExternalLink aria-hidden="true" className="size-4 text-muted" /> Visit website
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : null}
        {messageProfileId ? (
          <ActionMenuItem
            onClick={() => message(messageProfileId)}
            disabled={messaging}
            className={rowClass('message', itemClass)}
            icon={<MessageCircleMore aria-hidden="true" className="size-4 text-muted" />}
          >
            Message
          </ActionMenuItem>
        ) : null}
        {createCommunityHref ? (
          <a href={createCommunityHref} role="menuitem" onClick={close} className={rowClass('createCommunity', linkItemClass)}>
            <MessagesSquare aria-hidden="true" className="size-4 text-muted" /> Create a community
          </a>
        ) : null}
        <ActionMenuItem onClick={() => void copyLink()} className={itemClass} icon={<Link2 aria-hidden="true" className="size-4 text-muted" />}>
          Copy link
        </ActionMenuItem>
        <ActionMenuItem onClick={() => void share()} className={itemClass} icon={<Share2 aria-hidden="true" className="size-4 text-muted" />}>
          Share page
        </ActionMenuItem>
        {joinLink ? (
          <a
            href={joinLink.href}
            role="menuitem"
            onClick={() => {
              close()
              // Opens the collapsed "Work here?" row on phones, even when the hash is unchanged.
              if (joinLink.href.startsWith('#')) window.dispatchEvent(new CustomEvent(ORGANIZATION_ANCHOR_EVENT, { detail: joinLink.href }))
            }}
            className={linkItemClass}
          >
            <UserPlus aria-hidden="true" className="size-4 text-muted" /> {joinLink.label}
          </a>
        ) : null}
        {upgradeHref ? (
          <a href={upgradeHref} role="menuitem" onClick={close} className={rowClass('upgrade', linkItemClass)}>
            <Crown aria-hidden="true" className="size-4 text-muted" /> Upgrade to Organization Pro
          </a>
        ) : null}
        {leaveCompanyId ? (
          <ActionMenuItem
            onClick={() => {
              close()
              window.dispatchEvent(new CustomEvent(ORGANIZATION_LEAVE_OPEN_EVENT, { detail: leaveCompanyId }))
            }}
            className={`${itemClass} text-red-700`}
            icon={<LogOut aria-hidden="true" className="size-4" />}
          >
            Leave organization
          </ActionMenuItem>
        ) : null}
      </ActionMenu>
      <p role="status" aria-live="polite" className={status ? `absolute top-full z-40 mt-1.5 ${alignRight ? 'right-0' : 'left-0'} w-max max-w-[16rem] rounded-lg px-3 py-2 text-xs font-semibold shadow-sm max-md:fixed max-md:inset-x-4 max-md:bottom-24 max-md:top-auto max-md:z-[60] max-md:w-auto max-md:max-w-none max-md:text-sm ${status.tone === 'success' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}` : 'sr-only'}>
        {status ? <>{status.tone === 'success' ? <Check aria-hidden="true" className="mr-1 inline size-3.5" /> : null}{status.text}</> : null}
      </p>
    </div>
  )
}

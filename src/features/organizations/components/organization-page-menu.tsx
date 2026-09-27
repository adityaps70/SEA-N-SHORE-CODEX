'use client'

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { Check, Link2, MoreHorizontal, Share2, UserPlus } from 'lucide-react'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'

export type OrganizationMenuLink = { href: string; label: string }

function menuItems(menu: HTMLElement | null) {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}

/** "More" (⋯) menu on the organization page: copy link, share and join shortcuts. */
export function OrganizationPageMenu({
  organizationName,
  pagePath,
  joinLink,
}: {
  organizationName: string
  /** Path of the public page, e.g. /organizations/oceanic. */
  pagePath: string
  /** "Request to join" or "See your request", when it applies to the viewer. */
  joinLink?: OrganizationMenuLink | null
}) {
  const [open, setOpen] = useState(false)
  // Open towards whichever side has room, so the menu never runs off a phone screen.
  const [alignRight, setAlignRight] = useState(false)
  const [status, setStatus] = useState<{ tone: 'success' | 'error'; text: string } | null>(null)
  const pendingFocusRef = useRef<'first' | 'last' | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  const rootRef = useDismissibleLayer<HTMLDivElement>(open, close, { triggerRef })
  const menuId = useId()

  useEffect(() => {
    const pendingFocus = pendingFocusRef.current
    if (!open || !pendingFocus) return
    pendingFocusRef.current = null
    const entries = menuItems(menuRef.current)
    entries[pendingFocus === 'first' ? 0 : entries.length - 1]?.focus()
  }, [open])

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
      const entries = menuItems(menuRef.current)
      entries[target === 'first' ? 0 : entries.length - 1]?.focus()
      return
    }
    pendingFocusRef.current = target
    openMenu()
  }

  function onMenuKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const entries = menuItems(menuRef.current)
    if (!entries.length) return
    const index = entries.indexOf(document.activeElement as HTMLElement)
    let next: number | null = null
    if (event.key === 'ArrowDown') next = index < 0 ? 0 : (index + 1) % entries.length
    if (event.key === 'ArrowUp') next = index < 0 ? entries.length - 1 : (index - 1 + entries.length) % entries.length
    if (event.key === 'Home') next = 0
    if (event.key === 'End') next = entries.length - 1
    if (next === null) return
    event.preventDefault()
    entries[next]?.focus()
  }

  const itemClass = 'flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold text-navy-950 transition hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none'

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`More actions for ${organizationName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKeyDown}
        className="inline-flex size-10 cursor-pointer items-center justify-center rounded-xl border border-mist-200 bg-white text-navy-950 transition hover:border-navy-300 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500"
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={`More actions for ${organizationName}`}
          onKeyDown={onMenuKeyDown}
          className={`absolute top-full z-50 mt-1.5 w-56 rounded-xl border border-mist-100 bg-white p-1.5 shadow-[var(--shadow-card)] ${alignRight ? 'right-0' : 'left-0'}`}
        >
          <button type="button" role="menuitem" onClick={() => void copyLink()} className={itemClass}>
            <Link2 aria-hidden="true" className="size-4 text-muted" /> Copy link
          </button>
          <button type="button" role="menuitem" onClick={() => void share()} className={itemClass}>
            <Share2 aria-hidden="true" className="size-4 text-muted" /> Share page
          </button>
          {joinLink ? (
            <a href={joinLink.href} role="menuitem" onClick={close} className={itemClass}>
              <UserPlus aria-hidden="true" className="size-4 text-muted" /> {joinLink.label}
            </a>
          ) : null}
        </div>
      ) : null}
      <p role="status" aria-live="polite" className={status ? `absolute top-full z-40 mt-1.5 ${alignRight ? 'right-0' : 'left-0'} w-max max-w-[16rem] rounded-lg px-3 py-2 text-xs font-semibold shadow-sm ${status.tone === 'success' ? 'bg-emerald-50 text-emerald-900' : 'bg-red-50 text-red-800'}` : 'sr-only'}>
        {status ? <>{status.tone === 'success' ? <Check aria-hidden="true" className="mr-1 inline size-3.5" /> : null}{status.text}</> : null}
      </p>
    </div>
  )
}

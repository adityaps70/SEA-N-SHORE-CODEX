'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { Fragment, useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'

export type HeaderMenuItem = {
  href: string
  label: string
  description?: string
  icon?: ReactNode
  badge?: string
  /** A second, smaller link on the same row, e.g. "Manage" next to an organization. */
  secondary?: { href: string; label: string; accessibleLabel?: string }
  /** Consecutive items with the same group are shown together under this heading. */
  group?: string
  /** 'link' renders a plain text link row, e.g. "See all 5 organizations". */
  tone?: 'link'
}

type MenuSegment = { group: string | null; items: HeaderMenuItem[] }

function segmentsOf(items: HeaderMenuItem[]): MenuSegment[] {
  const segments: MenuSegment[] = []
  for (const item of items) {
    const group = item.group ?? null
    const last = segments[segments.length - 1]
    if (last && last.group === group) last.items.push(item)
    else segments.push({ group, items: [item] })
  }
  return segments
}

type HeaderMenuProps = {
  /** Accessible name of the trigger, e.g. "More" or "Account menu". */
  label: string
  /** Visible trigger content. */
  trigger: ReactNode
  items: HeaderMenuItem[]
  /** Rendered after the link items, e.g. a sign-out form. */
  footer?: ReactNode
  triggerClassName?: string
  activeTriggerClassName?: string
  align?: 'left' | 'right'
  /** Open below the trigger (default) or above it, for bottom bars. */
  direction?: 'down' | 'up'
  showChevron?: boolean
  /** Tailwind width of the open menu. */
  menuWidthClassName?: string
}

function itemIsActive(pathname: string | null, href: string) {
  if (!pathname || href.includes('#')) return false
  const path = href.split('?')[0]
  if (!path || path === '/') return false
  return pathname === path || pathname.startsWith(`${path}/`)
}

function menuItems(menu: HTMLElement | null) {
  return Array.from(menu?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])
}

export function HeaderMenu({
  label,
  trigger,
  items,
  footer,
  triggerClassName = '',
  activeTriggerClassName = '',
  align = 'right',
  direction = 'down',
  showChevron = true,
  menuWidthClassName = 'w-64',
}: HeaderMenuProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  // Which item receives focus when the menu opens from the keyboard.
  const pendingFocusRef = useRef<'first' | 'last' | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const close = useCallback(() => setOpen(false), [])
  const rootRef = useDismissibleLayer<HTMLDivElement>(open, close, { triggerRef })
  const menuId = useId()
  const containsActive = items.some((item) => itemIsActive(pathname, item.href))
  const segments = segmentsOf(items)

  useEffect(() => {
    const pendingFocus = pendingFocusRef.current
    if (!open || !pendingFocus) return
    pendingFocusRef.current = null
    const entries = menuItems(menuRef.current)
    entries[pendingFocus === 'first' ? 0 : entries.length - 1]?.focus()
  }, [open])

  function onTriggerKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const target = event.key === 'ArrowDown' ? 'first' : 'last'
      if (open) {
        const entries = menuItems(menuRef.current)
        entries[target === 'first' ? 0 : entries.length - 1]?.focus()
        return
      }
      pendingFocusRef.current = target
      setOpen(true)
    }
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

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        onKeyDown={onTriggerKeyDown}
        className={`${triggerClassName} ${containsActive ? activeTriggerClassName : ''}`.trim()}
      >
        {trigger}
        {showChevron ? <ChevronDown aria-hidden="true" className={`size-3.5 transition ${open ? 'rotate-180' : ''}`} /> : null}
      </button>
      {open ? (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={label}
          onKeyDown={onMenuKeyDown}
          className={`absolute z-50 ${menuWidthClassName} max-w-[calc(100vw-2rem)] rounded-xl border border-mist-100 bg-white p-1.5 shadow-[var(--shadow-card)] ${direction === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {segments.map((segment, index) => {
            const links = segment.items.map((item) => {
              const active = itemIsActive(pathname, item.href)
              const link = (
                <Link
                  key={item.href}
                  href={item.href}
                  role="menuitem"
                  title={item.secondary ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                  onClick={close}
                  className={`group/item flex min-w-0 items-start gap-3 rounded-lg px-3 py-2 text-sm text-navy-950 transition hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 ${item.secondary ? 'flex-1' : ''} ${active ? 'bg-ocean-50 text-ocean-800' : ''}`}
                >
                  {item.icon ? <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted">{item.icon}</span> : null}
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-2 font-semibold">
                      <span className={item.tone === 'link' ? 'text-ocean-700 group-hover/item:underline' : item.secondary ? 'line-clamp-2 break-words' : undefined}>{item.label}</span>
                      {item.badge ? (
                        <span className="shrink-0 rounded-full bg-mist-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">{item.badge}</span>
                      ) : null}
                    </span>
                    {item.description ? <span className="mt-0.5 block text-xs leading-5 text-muted">{item.description}</span> : null}
                  </span>
                </Link>
              )
              if (!item.secondary) return link
              return (
                <div key={item.href} className="flex items-center gap-1 pr-1.5">
                  {link}
                  <Link
                    href={item.secondary.href}
                    role="menuitem"
                    aria-label={item.secondary.accessibleLabel}
                    onClick={close}
                    className="inline-flex min-h-8 shrink-0 cursor-pointer items-center rounded-lg border border-mist-200 bg-white px-2.5 text-xs font-bold text-ocean-700 transition hover:border-ocean-300 hover:bg-ocean-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
                  >
                    {item.secondary.label}
                  </Link>
                </div>
              )
            })
            if (!segment.group) {
              return index > 0 && segments[index - 1].group
                ? <div key={`after-group-${index}`} className="mt-1 border-t border-mist-100 pt-1">{links}</div>
                : <Fragment key={`segment-${index}`}>{links}</Fragment>
            }
            const headingId = `${menuId}-group-${index}`
            return (
              <div key={`group-${index}`} role="group" aria-labelledby={headingId} className={index > 0 ? 'mt-1 border-t border-mist-100 pt-1' : undefined}>
                <p id={headingId} className="px-3 pb-0.5 pt-1.5 text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{segment.group}</p>
                {links}
              </div>
            )
          })}
          {footer ? <div className="mt-1 border-t border-mist-100 pt-1">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

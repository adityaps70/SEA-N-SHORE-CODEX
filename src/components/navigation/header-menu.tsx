'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useCallback, useId, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { useDismissibleLayer } from '@/hooks/use-dismissible-layer'

export type HeaderMenuItem = {
  href: string
  label: string
  description?: string
  icon?: ReactNode
  badge?: string
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
}

function itemIsActive(pathname: string | null, href: string) {
  if (!pathname || href.includes('#')) return false
  const path = href.split('?')[0]
  if (!path || path === '/') return false
  return pathname === path || pathname.startsWith(`${path}/`)
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
}: HeaderMenuProps) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const rootRef = useDismissibleLayer<HTMLDivElement>(open, close)
  const menuId = useId()
  const containsActive = items.some((item) => itemIsActive(pathname, item.href))

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((current) => !current)}
        className={`${triggerClassName} ${containsActive ? activeTriggerClassName : ''}`.trim()}
      >
        {trigger}
        {showChevron ? <ChevronDown aria-hidden="true" className={`size-3.5 transition ${open ? 'rotate-180' : ''}`} /> : null}
      </button>
      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          className={`absolute z-50 w-64 rounded-xl border border-mist-100 bg-white p-1.5 shadow-[var(--shadow-card)] ${direction === 'up' ? 'bottom-full mb-1.5' : 'top-full mt-1.5'} ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {items.map((item) => {
            const active = itemIsActive(pathname, item.href)
            return (
              <Link
                key={item.href}
                href={item.href}
                role="menuitem"
                aria-current={active ? 'page' : undefined}
                onClick={close}
                className={`flex items-start gap-3 rounded-lg px-3 py-2 text-sm text-navy-950 transition hover:bg-mist-50 ${active ? 'bg-ocean-50 text-ocean-800' : ''}`}
              >
                {item.icon ? <span aria-hidden="true" className="mt-0.5 shrink-0 text-muted">{item.icon}</span> : null}
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2 font-semibold">
                    {item.label}
                    {item.badge ? (
                      <span className="rounded-full bg-mist-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted">{item.badge}</span>
                    ) : null}
                  </span>
                  {item.description ? <span className="mt-0.5 block text-xs leading-5 text-muted">{item.description}</span> : null}
                </span>
              </Link>
            )
          })}
          {footer ? <div className="mt-1 border-t border-mist-100 pt-1">{footer}</div> : null}
        </div>
      ) : null}
    </div>
  )
}

'use client'

import Link from 'next/link'
import { Check, Link2, MoreHorizontal, Share2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { BottomSheet } from '@/components/ui/mobile-sheet'

/**
 * Phone "…" menu for a page or a list row (round 8): a round icon button that opens a bottom
 * sheet of links and share actions. Items are plain data plus server-rendered icons, so a server
 * page can hand them over. Hidden on md and wider unless `desktop` is set.
 */
export type PageAction =
  | { kind: 'link'; href: string; label: string; icon?: ReactNode; tone?: 'danger' }
  | { kind: 'share'; url: string; title: string; label?: string }
  | { kind: 'copy'; url: string; label?: string }

const ROW_CLASS =
  'flex min-h-14 w-full cursor-pointer items-center gap-4 rounded-2xl px-4 text-left text-[15px] font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 [&>svg]:size-5 [&>svg]:shrink-0'

export const PAGE_ACTIONS_TRIGGER_CLASS =
  'grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500'

function absoluteUrl(url: string) {
  if (typeof window === 'undefined') return url
  try {
    return new URL(url, window.location.origin).toString()
  } catch {
    return url
  }
}

export function PageActionsSheet({
  label,
  title,
  actions,
  triggerClassName = PAGE_ACTIONS_TRIGGER_CLASS,
  desktop = 'hidden',
}: {
  /** Accessible name of the "…" button, e.g. "More course actions". */
  label: string
  /** Sheet heading; defaults to no heading (grab handle only). */
  title?: string
  actions: PageAction[]
  triggerClassName?: string
  desktop?: 'dialog' | 'hidden'
}) {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const close = () => {
    setOpen(false)
    setCopied(false)
  }
  const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function'

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(absoluteUrl(url))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  async function share(url: string, shareTitle: string) {
    try {
      await navigator.share({ title: shareTitle, url: absoluteUrl(url) })
      close()
    } catch {
      // The person closed the share sheet; keep ours open.
    }
  }

  return (
    <>
      <button
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className={`${triggerClassName} ${desktop === 'hidden' ? 'md:hidden' : ''}`.trim()}
      >
        <MoreHorizontal aria-hidden="true" className="size-6" />
      </button>
      <BottomSheet open={open} onClose={close} title={title} desktop={desktop}>
        <div role="menu" aria-label={title ?? label} className="pt-1">
          {actions.map((action) => {
            if (action.kind === 'link') {
              const tone = action.tone === 'danger' ? 'text-red-700 hover:bg-red-50' : 'text-navy-950 hover:bg-mist-50'
              return (
                <Link key={`${action.href}-${action.label}`} role="menuitem" href={action.href} onClick={close} className={`${ROW_CLASS} ${tone}`}>
                  {action.icon ?? null}
                  <span className="min-w-0 flex-1">{action.label}</span>
                </Link>
              )
            }
            if (action.kind === 'share') {
              if (!canShare) return null
              return (
                <button key="share" type="button" role="menuitem" onClick={() => void share(action.url, action.title)} className={`${ROW_CLASS} text-navy-950 hover:bg-mist-50`}>
                  <Share2 aria-hidden="true" />
                  <span className="min-w-0 flex-1">{action.label ?? 'Share'}</span>
                </button>
              )
            }
            return (
              <button key="copy" type="button" role="menuitem" onClick={() => void copy(action.url)} className={`${ROW_CLASS} text-navy-950 hover:bg-mist-50`}>
                {copied ? <Check aria-hidden="true" className="text-teal-700" /> : <Link2 aria-hidden="true" />}
                <span className="min-w-0 flex-1">{action.label ?? 'Copy link'}</span>
                <span role="status" className="text-xs font-medium text-muted">{copied ? 'Copied' : ''}</span>
              </button>
            )
          })}
        </div>
        <div className="px-2 pt-2">
          <button
            type="button"
            onClick={close}
            className="flex min-h-12 w-full cursor-pointer items-center justify-center rounded-full border border-mist-300 text-[15px] font-semibold text-navy-700 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
          >
            Cancel
          </button>
        </div>
      </BottomSheet>
    </>
  )
}

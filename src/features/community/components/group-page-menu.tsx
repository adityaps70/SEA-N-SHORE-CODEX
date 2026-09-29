'use client'

import Link from 'next/link'
import { useCallback, useId, useRef, useState } from 'react'
import { Check, Flag, Link2, MoreHorizontal, Settings2 } from 'lucide-react'
import { ActionMenu, ActionMenuItem, ActionMenuSeparator } from '@/components/ui/action-menu'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'

/** "…" menu on the group page: Copy link, Report group and, for group admins, Edit group. */
export function GroupPageMenu({ groupId, groupName, pagePath, editHref }: { groupId: string; groupName: string; pagePath: string; editHref: string | null }) {
  const [open, setOpen] = useState(false)
  const [reportOpen, setReportOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuId = useId()
  const close = useCallback(() => setOpen(false), [])

  async function copyLink() {
    close()
    try {
      await navigator.clipboard.writeText(`${window.location.origin}${pagePath}`)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 3000)
    } catch {
      setCopied(false)
    }
  }

  const itemClass = 'py-2'
  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        aria-label={`More actions for ${groupName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
        className="inline-flex size-10 cursor-pointer items-center justify-center rounded-xl border border-mist-200 bg-white text-navy-950 transition hover:border-navy-300 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500 max-md:size-11 max-md:rounded-full max-md:border-ocean-700 max-md:text-ocean-700"
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>
      <ActionMenu open={open} onClose={close} anchorRef={triggerRef} id={menuId} label={`More actions for ${groupName}`} align="end" className="w-56 shadow-[var(--shadow-card)]">
        <ActionMenuItem onClick={() => void copyLink()} className={itemClass} icon={<Link2 aria-hidden="true" className="size-4 text-muted" />}>Copy link</ActionMenuItem>
        {editHref ? (
          <Link href={editHref} role="menuitem" onClick={close} className="flex min-h-9 w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-semibold text-navy-950 transition hover:bg-mist-50 focus-visible:bg-mist-50 focus-visible:outline-none max-md:min-h-13 max-md:gap-4 max-md:px-4 max-md:text-[15px]">
            <Settings2 aria-hidden="true" className="size-4 text-muted" /> Edit group
          </Link>
        ) : null}
        <ActionMenuSeparator />
        <ActionMenuItem tone="danger" onClick={() => { close(); setReportOpen(true) }} className={itemClass} icon={<Flag aria-hidden="true" className="size-4" />}>Report group</ActionMenuItem>
      </ActionMenu>
      <p role="status" aria-live="polite" className={copied ? 'absolute right-0 top-full z-40 mt-1.5 w-max rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-900 shadow-sm' : 'sr-only'}>
        {copied ? <><Check aria-hidden="true" className="mr-1 inline size-3.5" />Link copied</> : null}
      </p>
      {reportOpen ? (
        <ReportContentButton targetType="group" targetId={groupId} label="Report group" defaultOpen hideTrigger onClose={() => { setReportOpen(false); triggerRef.current?.focus() }} />
      ) : null}
    </div>
  )
}

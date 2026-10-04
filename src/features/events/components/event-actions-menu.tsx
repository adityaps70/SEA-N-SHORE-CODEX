'use client'

import { CalendarPlus, Check, Download, Flag, Link2, MoreHorizontal, ReceiptText, Share2, UserMinus } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useEffect, useState, useTransition, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { BottomSheet, SheetRow } from '@/components/ui/mobile-sheet'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'
import { withdrawEventAttendanceAction } from '../calendar-actions'

const linkRowClass = 'flex min-h-14 w-full items-center gap-4 rounded-2xl px-4 text-left text-[15px] font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 [&>svg]:size-5 [&>svg]:shrink-0'

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value)
    return
  }
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  document.execCommand('copy')
  document.body.removeChild(textarea)
}

/**
 * The event page's "…" in the phone page bar (round 8). The sheet is rendered into
 * document.body because the page bar is a sticky stacking context that would keep it under
 * the bottom tab bar.
 */
export function EventActionsMenu({
  eventId,
  title,
  googleCalendarHref,
  canWithdraw = false,
  canReport = false,
  paidRegistrationsHref = null,
}: {
  eventId: string
  title: string
  googleCalendarHref: string
  /** Free event the viewer is registered for (paid seats are refunded by the team instead). */
  canWithdraw?: boolean
  /** Everyone except the host can report an event. */
  canReport?: boolean
  /** Hosts of paid events. */
  paidRegistrationsHref?: string | null
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  useEffect(() => {
    if (!status) return
    const timer = window.setTimeout(() => setStatus(null), 3000)
    return () => window.clearTimeout(timer)
  }, [status])

  function close() {
    setOpen(false)
  }

  async function copyLink() {
    close()
    try {
      await copyText(window.location.href)
      setStatus('Link copied')
    } catch {
      setStatus('Copying was blocked. Copy the link from the address bar instead.')
    }
  }

  async function share() {
    if (navigator.share) {
      close()
      try {
        await navigator.share({ title, text: `Join me at ${title} on Sea N Shore.`, url: window.location.href })
        return
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }
    await copyLink()
  }

  function withdraw() {
    startTransition(async () => {
      const result = await withdrawEventAttendanceAction(eventId)
      close()
      if (!result.ok) {
        setStatus(result.error)
        return
      }
      setStatus('You are no longer attending.')
      router.refresh()
    })
  }

  function portal(node: ReactNode) {
    return typeof document === 'undefined' ? null : createPortal(node, document.body)
  }

  return (
    <>
      <button
        type="button"
        aria-label="More actions for this event"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="grid size-11 cursor-pointer place-items-center rounded-full text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500"
      >
        <MoreHorizontal aria-hidden="true" className="size-6" />
      </button>
      {open ? portal(
        <BottomSheet open onClose={close} title="Event options" desktop="hidden">
          <div role="menu" aria-label="Event options">
            <a role="menuitem" href={googleCalendarHref} target="_blank" rel="noreferrer" onClick={close} className={linkRowClass}>
              <CalendarPlus aria-hidden="true" /> Add to Google Calendar
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <a role="menuitem" href={`/events/${eventId}/calendar`} onClick={close} className={linkRowClass}>
              <Download aria-hidden="true" /> Download .ics
            </a>
            <SheetRow role="menuitem" icon={<Share2 aria-hidden="true" />} label="Share event" onClick={() => void share()} />
            <SheetRow role="menuitem" icon={<Link2 aria-hidden="true" />} label="Copy event link" onClick={() => void copyLink()} />
            {paidRegistrationsHref ? (
              <Link role="menuitem" href={paidRegistrationsHref} onClick={close} className={linkRowClass}>
                <ReceiptText aria-hidden="true" /> Paid registrations
              </Link>
            ) : null}
            {canWithdraw ? (
              <SheetRow role="menuitem" tone="danger" disabled={pending} icon={<UserMinus aria-hidden="true" />} label={pending ? 'Updating…' : 'Withdraw attendance'} onClick={withdraw} />
            ) : null}
            {canReport ? (
              <SheetRow role="menuitem" tone="danger" icon={<Flag aria-hidden="true" />} label="Report event" onClick={() => { close(); setReporting(true) }} />
            ) : null}
          </div>
        </BottomSheet>,
      ) : null}
      {reporting ? portal(
        <ReportContentButton targetType="event" targetId={eventId} hideTrigger defaultOpen onClose={() => setReporting(false)} />,
      ) : null}
      {status ? portal(
        <p role="status" className="fixed inset-x-4 bottom-[calc(9rem+env(safe-area-inset-bottom))] z-[80] flex items-center gap-2 rounded-xl bg-navy-950 px-4 py-3 text-sm font-semibold text-white shadow-lg md:hidden">
          <Check aria-hidden="true" className="size-4 shrink-0" /> {status}
        </p>,
      ) : null}
    </>
  )
}

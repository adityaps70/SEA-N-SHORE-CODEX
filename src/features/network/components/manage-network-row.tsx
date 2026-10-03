'use client'

import Link from 'next/link'
import { useState } from 'react'
import { Building2, ChevronRight, MailPlus, UserRoundCheck, UsersRound } from 'lucide-react'
import { BottomSheet } from '@/components/ui/mobile-sheet'

const rowClass = 'flex min-h-14 w-full items-center gap-4 rounded-2xl px-4 text-left text-[15px] font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 [&>svg]:size-5 [&>svg]:shrink-0'

/**
 * Phones: "Manage my network ›" row on the Network tab. It opens a sheet with the existing
 * network views — Connections, Following & followers, Invitations — and organization Pages.
 */
export function ManageNetworkRow({ incomingRequestCount }: { incomingRequestCount: number }) {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
        className="-mx-4 flex min-h-14 w-[calc(100%+2rem)] cursor-pointer items-center justify-between gap-3 border-b border-mist-100 bg-white px-4 text-left text-[16px] font-bold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ocean-500 md:hidden"
      >
        Manage my network
        <ChevronRight aria-hidden="true" className="size-5 text-navy-700" />
      </button>
      <BottomSheet open={open} onClose={close} title="Manage my network" desktop="hidden">
        <nav aria-label="Manage my network" className="grid">
          <Link href="/network?tab=connections" onClick={close} className={rowClass}>
            <UsersRound aria-hidden="true" />
            <span className="min-w-0 flex-1">Connections</span>
          </Link>
          <Link href="/network?tab=following" onClick={close} className={rowClass}>
            <UserRoundCheck aria-hidden="true" />
            <span className="min-w-0 flex-1">Following &amp; followers</span>
          </Link>
          <Link href="/network?tab=requests" onClick={close} className={rowClass}>
            <MailPlus aria-hidden="true" />
            <span className="min-w-0 flex-1">Invitations</span>
            {incomingRequestCount > 0 ? (
              <span className="rounded-full bg-ocean-100 px-2 py-0.5 text-xs font-bold text-ocean-800">
                {incomingRequestCount > 99 ? '99+' : incomingRequestCount}
              </span>
            ) : null}
          </Link>
          <Link href="/organizations" onClick={close} className={rowClass}>
            <Building2 aria-hidden="true" />
            <span className="min-w-0 flex-1">Pages</span>
          </Link>
        </nav>
      </BottomSheet>
    </>
  )
}

'use client'

import Link from 'next/link'
import { Eye, MoreHorizontal, PencilLine, Users } from 'lucide-react'
import { useState } from 'react'
import { BottomSheet, MobileSheetCancel } from '@/components/ui/mobile-sheet'
import type { JobLifecycleSnapshot } from '../job-lifecycle'
import { HiringJobLifecycleActions } from './hiring-job-lifecycle-actions'
import { MORE_BUTTON_CLASS } from './mobile-chip'
import { SheetPortal } from './sheet-portal'

const ROW_LINK_CLASS =
  'flex min-h-14 w-full items-center gap-4 rounded-2xl px-4 text-left text-[15px] font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 [&>svg]:size-5 [&>svg]:shrink-0'

/**
 * Phone "…" sheet for one vacancy on /hiring/jobs (round 8): View applicants, Edit, View live job,
 * then the lifecycle actions (Publish, Republish, Archive, Delete) with their confirmations.
 */
export function HiringJobRowMenu({
  jobId,
  jobTitle,
  lifecycle,
  today,
  live,
  applicantCount,
}: {
  jobId: string
  jobTitle: string
  lifecycle: JobLifecycleSnapshot
  today: string
  live: boolean
  applicantCount: number
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button
        type="button"
        aria-label={`Manage ${jobTitle}`}
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className={`${MORE_BUTTON_CLASS} -mr-2 -mt-2 md:hidden`}
      >
        <MoreHorizontal aria-hidden="true" className="size-5" />
      </button>
      <SheetPortal>
        <BottomSheet open={open} onClose={() => setOpen(false)} desktop="hidden" title={jobTitle}>
          <nav aria-label={`${jobTitle} links`}>
            <Link href={`/hiring/jobs/${jobId}/applicants`} className={ROW_LINK_CLASS}>
              <Users aria-hidden="true" />
              <span className="flex-1">View applicants</span>
              <span className="text-xs font-medium text-muted">{applicantCount}</span>
            </Link>
            <Link href={`/hiring/jobs/${jobId}/edit`} className={ROW_LINK_CLASS}>
              <PencilLine aria-hidden="true" />
              Edit
            </Link>
            {live ? (
              <Link href={`/jobs/${jobId}`} className={ROW_LINK_CLASS}>
                <Eye aria-hidden="true" />
                View live job
              </Link>
            ) : null}
          </nav>
          <div className="mt-1 border-t border-mist-100 pt-1">
            <HiringJobLifecycleActions jobId={jobId} jobTitle={jobTitle} lifecycle={lifecycle} today={today} layout="sheet" />
          </div>
          <div className="px-2">
            <MobileSheetCancel onClick={() => setOpen(false)} />
          </div>
        </BottomSheet>
      </SheetPortal>
    </>
  )
}

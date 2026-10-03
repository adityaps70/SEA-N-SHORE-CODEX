'use client'

import Link from 'next/link'
import { Building2, Flag, Link2, MoreHorizontal, Share2 } from 'lucide-react'
import { useState } from 'react'
import { BottomSheet, MobileSheetCancel, SheetRow } from '@/components/ui/mobile-sheet'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'
import { SHARE_OUTCOME_MESSAGE, copyText, jobShareUrl, shareLink } from '../share'
import { MORE_BUTTON_CLASS } from './mobile-chip'
import { SheetPortal } from './sheet-portal'

const ROW_LINK_CLASS =
  'flex min-h-14 w-full items-center gap-4 rounded-2xl px-4 text-left text-[15px] font-semibold text-navy-950 hover:bg-mist-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ocean-500 [&>svg]:size-5 [&>svg]:shrink-0'

/** Phone "…" sheet for a job detail page: View organization, Share, Copy link, Report job. */
export function JobDetailMoreMenu({
  jobId,
  jobTitle,
  companyName,
  companyHref,
}: {
  jobId: string
  jobTitle: string
  companyName: string
  companyHref: string | null
}) {
  const [open, setOpen] = useState(false)
  const [reporting, setReporting] = useState(false)
  const [message, setMessage] = useState('')

  async function share() {
    const outcome = await shareLink({ title: jobTitle, text: `${jobTitle} at ${companyName} on Sea N Shore`, url: jobShareUrl(jobId) })
    setMessage(SHARE_OUTCOME_MESSAGE[outcome])
    if (outcome === 'shared') setOpen(false)
  }

  async function copy() {
    setMessage((await copyText(jobShareUrl(jobId))) ? 'Link copied.' : SHARE_OUTCOME_MESSAGE.failed)
  }

  return (
    <>
      <button
        type="button"
        aria-label="More job actions"
        aria-haspopup="dialog"
        onClick={() => {
          setMessage('')
          setOpen(true)
        }}
        className={MORE_BUTTON_CLASS}
      >
        <MoreHorizontal aria-hidden="true" className="size-6" />
      </button>
      <SheetPortal>
      <BottomSheet open={open} onClose={() => setOpen(false)} desktop="hidden">
        <div role="menu" aria-label="Job actions">
          {companyHref ? (
            <Link role="menuitem" href={companyHref} className={ROW_LINK_CLASS}>
              <Building2 aria-hidden="true" />
              View organization
            </Link>
          ) : null}
          <SheetRow role="menuitem" icon={<Share2 aria-hidden="true" />} label="Share" onClick={share} />
          <SheetRow role="menuitem" icon={<Link2 aria-hidden="true" />} label="Copy link" onClick={copy} />
          <SheetRow
            role="menuitem"
            tone="danger"
            icon={<Flag aria-hidden="true" />}
            label="Report job"
            onClick={() => {
              setOpen(false)
              setReporting(true)
            }}
          />
        </div>
        <p role="status" className="min-h-5 px-4 text-sm font-medium text-ocean-700">{message}</p>
        <div className="px-2"><MobileSheetCancel onClick={() => setOpen(false)} /></div>
      </BottomSheet>
      {reporting ? (
        <ReportContentButton targetType="job" targetId={jobId} label="Report this job" hideTrigger defaultOpen onClose={() => setReporting(false)} />
      ) : null}
      </SheetPortal>
    </>
  )
}

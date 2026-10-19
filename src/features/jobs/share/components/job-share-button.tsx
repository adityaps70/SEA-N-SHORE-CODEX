'use client'

import { Share2 } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { secondaryButtonClass } from '@/components/ui/interactive-styles'
import { JobSharePanel } from './job-share-panel'

/**
 * Round I (I1): "Share job" for the job's poster (job page, hiring list, after publishing). Only rendered when the
 * server has said the viewer may share this job; the panel and image check again.
 */
export function JobShareButton({
  jobId,
  label = 'Share job',
  className = secondaryButtonClass,
  defaultOpen = false,
  icon = <Share2 aria-hidden="true" className="size-4" />,
}: {
  jobId: string
  label?: string
  className?: string
  defaultOpen?: boolean
  icon?: ReactNode
}) {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className={className} data-testid="job-share-button">
        {icon}{label}
      </button>
      <JobSharePanel jobId={jobId} open={open} onClose={() => setOpen(false)} />
    </>
  )
}

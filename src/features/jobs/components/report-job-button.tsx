'use client'

import Link from '@/components/navigation/intent-link'
import { Flag } from 'lucide-react'
import { reportButtonClass } from '@/components/ui/interactive-styles'
import { ReportContentButton } from '@/features/moderation/components/report-content-button'

export function ReportJobButton({ jobId, signInHref }: { jobId: string; signInHref?: string }) {
  return (
    <div className="rounded-2xl border border-mist-100 bg-mist-50/60 p-4">
      {/* Round H (H5): signed-out visitors sign in first, then come back to the job to report it. */}
      {signInHref ? (
        <Link href={signInHref} className={reportButtonClass}>
          <Flag aria-hidden="true" className="size-4" />
          Report this job
        </Link>
      ) : (
        <ReportContentButton
          targetType="job"
          targetId={jobId}
          label="Report this job"
        />
      )}
      <p className="mt-2 text-xs leading-5 text-muted">
        Reports are reviewed by Sea N Shore administrators and do not automatically remove a vacancy.
      </p>
    </div>
  )
}

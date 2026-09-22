'use client'

import { ReportContentButton } from '@/features/moderation/components/report-content-button'

export function ReportJobButton({ jobId }: { jobId: string }) {
  return (
    <div className="rounded-2xl border border-mist-100 bg-mist-50/60 p-4">
      <ReportContentButton
        targetType="job"
        targetId={jobId}
        label="Report this job"
        className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-navy-950"
      />
      <p className="mt-2 text-xs leading-5 text-muted">
        Reports are reviewed by Sea N Shore administrators and do not automatically remove a vacancy.
      </p>
    </div>
  )
}

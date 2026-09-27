'use client'

import { ReportContentButton } from '@/features/moderation/components/report-content-button'

export function ReportJobButton({ jobId }: { jobId: string }) {
  return (
    <div className="rounded-2xl border border-mist-100 bg-mist-50/60 p-4">
      <ReportContentButton
        targetType="job"
        targetId={jobId}
        label="Report this job"
      />
      <p className="mt-2 text-xs leading-5 text-muted">
        Reports are reviewed by Sea N Shore administrators and do not automatically remove a vacancy.
      </p>
    </div>
  )
}

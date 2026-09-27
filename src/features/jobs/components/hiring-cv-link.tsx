import { Download, ExternalLink, FileText } from 'lucide-react'

function formatBytes(bytes: number) {
  if (bytes >= 1024 * 1024) {
    const mb = bytes / (1024 * 1024)
    return `${Number.isInteger(mb) ? mb.toFixed(0) : mb.toFixed(1)} MB`
  }
  if (bytes >= 1024) {
    const kb = bytes / 1024
    return `${Math.max(1, Math.round(kb))} KB`
  }
  return `${bytes} B`
}

/** The authorized, first-party CV route. Every request is checked against the job's hiring team. */
export function hiringCvHref(applicationId: string, download = false) {
  return `/api/jobs/applications/${applicationId}/cv${download ? '?download=1' : ''}`
}

export function HiringCvLink({
  applicationId,
  fileName,
  sizeBytes,
}: {
  applicationId: string
  fileName: string
  sizeBytes: number
}) {
  return (
    <div className="rounded-2xl border border-mist-100 bg-mist-50 p-4">
      <div className="flex items-start gap-3">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-white text-ocean-700 shadow-sm">
          <FileText aria-hidden="true" className="size-4.5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-navy-950">{fileName}</p>
          <p className="mt-0.5 text-xs text-muted">{formatBytes(sizeBytes)} · PDF attachment</p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <a
          href={hiringCvHref(applicationId)}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-10 flex-1 basis-32 items-center justify-center gap-2 whitespace-nowrap rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2"
        >
          View CV (PDF)
          <ExternalLink aria-hidden="true" className="size-4" />
        </a>
        <a
          href={hiringCvHref(applicationId, true)}
          className="inline-flex min-h-10 flex-1 basis-32 items-center justify-center gap-2 whitespace-nowrap rounded-xl border border-mist-200 bg-white px-4 text-sm font-bold text-navy-950 hover:bg-mist-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ocean-500 focus-visible:ring-offset-2"
        >
          Download
          <Download aria-hidden="true" className="size-4" />
        </a>
      </div>
    </div>
  )
}

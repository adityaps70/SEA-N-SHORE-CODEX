import { ExternalLink, FileText } from 'lucide-react'

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

export function HiringCvLink({
  href,
  fileName,
  sizeBytes,
}: {
  href: string
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
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="mt-3 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-bold text-white hover:bg-navy-900"
      >
        View CV (PDF)
        <ExternalLink aria-hidden="true" className="size-4" />
      </a>
    </div>
  )
}

'use client'

import { useState, type MouseEvent } from 'react'
import { Download, FileArchive, FileJson2 } from 'lucide-react'

type Format = 'zip' | 'json'

function filenameFrom(response: Response, format: Format) {
  const match = /filename="([^"]+)"/.exec(response.headers.get('content-disposition') ?? '')
  return match?.[1] ?? `sea-n-shore-data-export.${format}`
}

export function DataExportPanel() {
  const [pending, setPending] = useState<Format | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)

  // The links still work without JavaScript. With JavaScript we download in the
  // background so a failure shows a clear message instead of saving an error file.
  async function download(event: MouseEvent<HTMLAnchorElement>, format: Format) {
    if (typeof window.fetch !== 'function' || typeof URL.createObjectURL !== 'function') return
    event.preventDefault()
    if (pending) return
    setPending(format)
    setError(null)
    setDone(null)
    try {
      const response = await fetch(`/api/account/export?format=${format}`, { credentials: 'same-origin' })
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null
        setError(body?.error ?? 'We could not prepare your data export right now. Please try again in a minute.')
        return
      }
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = filenameFrom(response, format)
      document.body.appendChild(link)
      link.click()
      link.remove()
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000)
      setDone(`Your ${format === 'zip' ? 'ZIP package' : 'JSON file'} has downloaded. Check your downloads folder.`)
    } catch {
      setError('We could not reach Sea N Shore. Check your connection and try again.')
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex flex-col gap-5">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
              <FileArchive aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700">Your information</p>
              <h2 className="mt-0.5 text-xl font-semibold text-navy-950">Download my data</h2>
            </div>
          </div>

          <p className="mt-3 text-sm leading-6 text-muted">
            Download a portable copy of your Sea N Shore account data, including profile information, posts and
            comments, connections and follows, messages you sent, job and event activity, and applicable learning and
            organization data.
          </p>
          <p className="mt-2 text-sm leading-6 text-muted">
            For most people, the <span className="font-semibold text-navy-950">ZIP package</span> is easiest: it includes
            spreadsheet-friendly <span className="font-semibold text-navy-950">CSV files</span> you can open in Excel,
            Numbers, or Google Sheets, plus the complete JSON copy.
          </p>
          <p className="mt-2 text-xs leading-5 text-muted">
            The export can contain private account information. Store it securely and only share it when you intend to.
          </p>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <a
            href="/api/account/export?format=zip"
            download
            onClick={(event) => void download(event, 'zip')}
            aria-busy={pending === 'zip'}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition hover:bg-navy-900"
          >
            <Download aria-hidden="true" className="size-4" />
            {pending === 'zip' ? 'Preparing ZIP…' : 'Download ZIP'}
          </a>
          <a
            href="/api/account/export?format=json"
            download
            onClick={(event) => void download(event, 'json')}
            aria-busy={pending === 'json'}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 transition hover:border-ocean-300 hover:bg-ocean-50/40"
          >
            <FileJson2 aria-hidden="true" className="size-4" />
            {pending === 'json' ? 'Preparing JSON…' : 'Download JSON'}
          </a>
        </div>
        {error ? <p role="alert" className="rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-sm text-red-800">{error}</p> : null}
        {done ? <p role="status" className="rounded-xl border border-mist-200 bg-mist-50 px-3.5 py-2.5 text-sm text-navy-950">{done}</p> : null}
      </div>
    </section>
  )
}

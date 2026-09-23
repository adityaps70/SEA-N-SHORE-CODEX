import { Download, FileArchive, FileJson2 } from 'lucide-react'

export function DataExportPanel() {
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
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition hover:bg-navy-900"
          >
            <Download aria-hidden="true" className="size-4" />
            Download ZIP
          </a>
          <a
            href="/api/account/export?format=json"
            download
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-mist-200 bg-white px-4 text-sm font-semibold text-navy-950 transition hover:border-ocean-300 hover:bg-ocean-50/40"
          >
            <FileJson2 aria-hidden="true" className="size-4" />
            Download JSON
          </a>
        </div>
      </div>
    </section>
  )
}

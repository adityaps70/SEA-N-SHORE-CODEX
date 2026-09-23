import { Download, FileJson2 } from 'lucide-react'

export function DataExportPanel() {
  return (
    <section className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
              <FileJson2 aria-hidden="true" className="size-5" />
            </span>
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-ocean-700">Your information</p>
              <h2 className="mt-0.5 text-xl font-semibold text-navy-950">Download my data</h2>
            </div>
          </div>

          <p className="mt-3 text-sm leading-6 text-muted">
            Export a portable copy of your Sea N Shore account data as JSON. The export includes profile information,
            posts and comments, connections and follows, messages you sent, job and event activity, and applicable
            learning and organization data.
          </p>
          <p className="mt-2 text-xs leading-5 text-muted">
            The file can contain private account information. Store it securely and only share it when you intend to.
          </p>
        </div>

        <a
          href="/api/account/export"
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-navy-950 px-4 text-sm font-semibold text-white transition hover:bg-navy-900"
        >
          <Download aria-hidden="true" className="size-4" />
          Export my data
        </a>
      </div>
    </section>
  )
}

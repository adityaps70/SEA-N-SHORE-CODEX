import type { Metadata } from 'next'
import Link from 'next/link'
import { Flag, Scale, ShieldCheck } from 'lucide-react'

export const metadata: Metadata = { title: 'Copyright & IP' }

export default function CopyrightPage() {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6 sm:py-14">
      <section className="rounded-[2rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-9">
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Trust, rights &amp; safety</p>
        <h1 className="mt-2 text-3xl font-bold tracking-tight text-navy-950 sm:text-4xl">Copyright &amp; Intellectual Property Policy</h1>
        <p className="mt-3 max-w-3xl text-sm leading-7 text-muted">
          Sea N Shore respects the intellectual-property rights of members, companies, educators, publishers and other rights holders. This page explains how ownership works and how to submit a copyright or IP complaint for specific user-generated content.
        </p>
        <p className="mt-2 text-xs font-medium text-muted">Last updated: 23 September 2026</p>
      </section>

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
          <Scale aria-hidden="true" className="size-6 text-ocean-700" />
          <h2 className="mt-3 text-lg font-bold text-navy-950">Creators keep ownership</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Members keep ownership of the original content and IP rights they hold. Posting on Sea N Shore gives the platform only the licence described in the Terms so the service can host, display and operate that content.
          </p>
        </section>
        <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
          <ShieldCheck aria-hidden="true" className="size-6 text-ocean-700" />
          <h2 className="mt-3 text-lg font-bold text-navy-950">Only post what you may use</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            Upload content only when you own it, have permission, or have another lawful basis to use it. This applies to photographs, videos, documents, articles, course materials, logos and other protected works.
          </p>
        </section>
        <section className="rounded-[1.5rem] border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)]">
          <Flag aria-hidden="true" className="size-6 text-red-700" />
          <h2 className="mt-3 text-lg font-bold text-navy-950">Complaints are reviewed</h2>
          <p className="mt-2 text-sm leading-6 text-muted">
            A copyright complaint is a moderation case, not an automatic takedown. Administrators review the notice, the identified content and the available information before deciding what action is appropriate.
          </p>
        </section>
      </div>

      <section className="mt-6 rounded-[1.75rem] border border-mist-100 bg-white p-6 shadow-[var(--shadow-card)] sm:p-8">
        <h2 className="text-2xl font-bold text-navy-950">How to report copyrighted or infringing content</h2>
        <ol className="mt-5 space-y-4 text-sm leading-7 text-muted">
          <li><strong className="text-navy-950">1. Open the exact content.</strong> Use the Report control on the post, comment, job or event you believe infringes your rights.</li>
          <li><strong className="text-navy-950">2. Choose “Copyright or intellectual property infringement”.</strong> This identifies the complaint for the trust-and-safety review workflow.</li>
          <li><strong className="text-navy-950">3. Provide enough detail to assess it.</strong> Identify the original work, describe the allegedly infringing material, explain your ownership or authority to act, and include a source/reference where available.</li>
          <li><strong className="text-navy-950">4. Submit the report.</strong> The complaint is recorded in the moderation queue. Administrators can mark it reviewing, remove content, resolve or dismiss the case, and record a reviewer note.</li>
        </ol>

        <div className="mt-6 rounded-2xl bg-mist-50 p-4 text-sm leading-6 text-muted">
          <p className="font-bold text-navy-950">Please submit complaints in good faith.</p>
          <p className="mt-1">Do not knowingly misrepresent ownership, authorization or infringement. Sea N Shore may request additional information and may restrict abusive use of the reporting system.</p>
        </div>

        <div className="mt-6 flex flex-wrap gap-3">
          <Link href="/terms" className="rounded-xl bg-navy-950 px-4 py-2.5 text-sm font-semibold text-white hover:bg-navy-900">Read Terms</Link>
          <Link href="/auth/sign-in" className="rounded-xl border border-mist-100 bg-white px-4 py-2.5 text-sm font-semibold text-navy-950 hover:bg-mist-50">Sign in to report content</Link>
        </div>
      </section>
    </main>
  )
}

import Link from 'next/link'
import { LockKeyhole, ShieldCheck } from 'lucide-react'
import { DeleteAccountPanel } from '@/features/account-deletion/components/delete-account-panel'

export default function SettingsPage() {
  return (
    <section className="mx-auto grid max-w-4xl gap-5 py-2 sm:py-5">
      <header>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-ocean-700">Account</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">Settings</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Manage account security, privacy, and permanent account actions from one place.
        </p>
      </header>

      <section className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
            <ShieldCheck aria-hidden="true" className="size-5" />
          </span>
          <div>
            <h2 className="text-lg font-semibold text-navy-950">Account & privacy</h2>
            <p className="mt-1 text-sm leading-6 text-muted">
              Review how your account is protected and how your information is handled across Sea N Shore.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <Link
            href="/privacy"
            className="rounded-xl border border-mist-100 bg-mist-50/50 p-4 transition hover:border-ocean-300 hover:bg-ocean-50/40"
          >
            <p className="font-semibold text-navy-950">Privacy</p>
            <p className="mt-1 text-sm leading-5 text-muted">Read how profile, community, jobs, learning, and messaging data is used.</p>
          </Link>
          <div className="rounded-xl border border-mist-100 bg-mist-50/50 p-4">
            <div className="flex items-center gap-2">
              <LockKeyhole aria-hidden="true" className="size-4 text-ocean-700" />
              <p className="font-semibold text-navy-950">Security</p>
            </div>
            <p className="mt-1 text-sm leading-5 text-muted">Sensitive account actions require a fresh password verification.</p>
          </div>
        </div>
      </section>

      <DeleteAccountPanel />
    </section>
  )
}

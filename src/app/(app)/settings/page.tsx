import type { Metadata } from 'next'
import Link from 'next/link'
import { BadgeCheck, Building2, ChevronRight, CreditCard, LockKeyhole, Mail, ShieldCheck, SquarePlus } from 'lucide-react'
import { DataExportPanel } from '@/features/account-export/components/data-export-panel'
import { DeleteAccountPanel } from '@/features/account-deletion/components/delete-account-panel'

export const metadata: Metadata = { title: 'Settings' }

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
            href="/settings/billing"
            className="group relative rounded-xl border border-mist-200 bg-white p-4 pr-10 transition hover:border-ocean-300 hover:bg-ocean-50/40 hover:shadow-sm"
          >
            <div className="flex items-center gap-2">
              <CreditCard aria-hidden="true" className="size-4 text-ocean-700" />
              <p className="font-semibold text-navy-950">Membership & billing</p>
            </div>
            <p className="mt-1 text-sm leading-5 text-muted">Review Free, Creator Pro and Organization Pro access.</p>
            <ChevronRight aria-hidden="true" className="absolute right-3 top-1/2 size-5 -translate-y-1/2 text-muted transition group-hover:translate-x-0.5 group-hover:text-ocean-700" />
          </Link>
          <Link
            href="/settings/verifications"
            className="group relative rounded-xl border border-mist-200 bg-white p-4 pr-10 transition hover:border-ocean-300 hover:bg-ocean-50/40 hover:shadow-sm"
          >
            <div className="flex items-center gap-2">
              <BadgeCheck aria-hidden="true" className="size-4 text-ocean-700" />
              <p className="font-semibold text-navy-950">Professional verifications</p>
            </div>
            <p className="mt-1 text-sm leading-5 text-muted">Apply for or review Recruiter, Trainer and Event Host verification.</p>
            <ChevronRight aria-hidden="true" className="absolute right-3 top-1/2 size-5 -translate-y-1/2 text-muted transition group-hover:translate-x-0.5 group-hover:text-ocean-700" />
          </Link>
          <Link
            href="/organizations"
            className="group relative rounded-xl border border-mist-200 bg-white p-4 pr-10 transition hover:border-ocean-300 hover:bg-ocean-50/40 hover:shadow-sm"
          >
            <div className="flex items-center gap-2">
              <Building2 aria-hidden="true" className="size-4 text-ocean-700" />
              <p className="font-semibold text-navy-950">Organizations</p>
            </div>
            <p className="mt-1 text-sm leading-5 text-muted">Create, claim or manage organization workspaces and roles.</p>
            <ChevronRight aria-hidden="true" className="absolute right-3 top-1/2 size-5 -translate-y-1/2 text-muted transition group-hover:translate-x-0.5 group-hover:text-ocean-700" />
          </Link>
          <Link
            href="/creator"
            className="group relative rounded-xl border border-mist-200 bg-white p-4 pr-10 transition hover:border-ocean-300 hover:bg-ocean-50/40 hover:shadow-sm"
          >
            <div className="flex items-center gap-2">
              <SquarePlus aria-hidden="true" className="size-4 text-ocean-700" />
              <p className="font-semibold text-navy-950">Creator access</p>
            </div>
            <p className="mt-1 text-sm leading-5 text-muted">See publishing readiness for Jobs, Events and LMS in one place.</p>
            <ChevronRight aria-hidden="true" className="absolute right-3 top-1/2 size-5 -translate-y-1/2 text-muted transition group-hover:translate-x-0.5 group-hover:text-ocean-700" />
          </Link>
          <Link
            href="/newsletter"
            className="group relative rounded-xl border border-mist-200 bg-white p-4 pr-10 transition hover:border-ocean-300 hover:bg-ocean-50/40 hover:shadow-sm"
          >
            <div className="flex items-center gap-2">
              <Mail aria-hidden="true" className="size-4 text-ocean-700" />
              <p className="font-semibold text-navy-950">Newsletter</p>
            </div>
            <p className="mt-1 text-sm leading-5 text-muted">Subscribe, choose topics or unsubscribe from Sea N Shore emails.</p>
            <ChevronRight aria-hidden="true" className="absolute right-3 top-1/2 size-5 -translate-y-1/2 text-muted transition group-hover:translate-x-0.5 group-hover:text-ocean-700" />
          </Link>
          <Link
            href="/privacy"
            className="group relative rounded-xl border border-mist-200 bg-white p-4 pr-10 transition hover:border-ocean-300 hover:bg-ocean-50/40 hover:shadow-sm"
          >
            <p className="font-semibold text-navy-950">Privacy</p>
            <p className="mt-1 text-sm leading-5 text-muted">Read how profile, community, jobs, learning, and messaging data is used.</p>
            <ChevronRight aria-hidden="true" className="absolute right-3 top-1/2 size-5 -translate-y-1/2 text-muted transition group-hover:translate-x-0.5 group-hover:text-ocean-700" />
          </Link>
        </div>
        <p className="mt-4 flex items-start gap-2 text-sm leading-5 text-muted">
          <LockKeyhole aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ocean-700" />
          <span><span className="font-semibold text-navy-950">Security:</span> sensitive account actions require a fresh password verification.</span>
        </p>
      </section>

      <div id="your-data" className="grid scroll-mt-24 gap-5">
        <h2 className="sr-only">Your data and privacy controls</h2>
        <DataExportPanel />
        <DeleteAccountPanel />
      </div>
    </section>
  )
}

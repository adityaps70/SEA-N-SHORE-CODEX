import type { Metadata } from 'next'
import Link from 'next/link'
import { CheckCircle2 } from 'lucide-react'
import { Wordmark } from '@/components/brand/wordmark'

export const metadata: Metadata = { title: 'Account deleted' }

export default function AccountDeletedPage() {
  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,var(--mist-50),white)] px-4 py-8 sm:px-6">
      <div className="mx-auto max-w-2xl">
        <div className="mb-10">
          <Wordmark compact />
        </div>

        <section className="rounded-[1.75rem] border border-mist-100 bg-white p-6 text-center shadow-[var(--shadow-card)] sm:p-10">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-emerald-50 text-emerald-700">
            <CheckCircle2 aria-hidden="true" className="size-7" />
          </span>
          <h1 className="mt-5 text-3xl font-semibold tracking-[-0.03em] text-navy-950">
            Your account has been deleted
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-sm leading-6 text-muted sm:text-base">
            Your sign-in identity has been removed and your Sea N Shore account has been deleted or anonymized according to the deletion summary you reviewed.
          </p>
          <p className="mx-auto mt-3 max-w-xl text-sm leading-6 text-muted">
            You have been signed out. If you return in the future, you can create a new account.
          </p>
          <Link
            href="/"
            className="mt-7 inline-flex min-h-11 items-center justify-center rounded-xl bg-ocean-700 px-5 text-sm font-semibold text-white transition hover:bg-ocean-800"
          >
            Return to Sea N Shore
          </Link>
        </section>
      </div>
    </main>
  )
}

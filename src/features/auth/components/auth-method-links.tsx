import Link from 'next/link'

export function AuthMethodLinks({
  intent,
  googleEnabled = true,
}: {
  intent: 'sign-in' | 'sign-up'
  googleEnabled?: boolean
}) {
  return (
    <div className="mt-6 grid gap-3">
      <div className="flex items-center gap-3 text-xs font-semibold uppercase tracking-[0.14em] text-muted">
        <span className="h-px flex-1 bg-mist-100" />
        <span>or continue with</span>
        <span className="h-px flex-1 bg-mist-100" />
      </div>

      <Link
        href={`/auth/phone?intent=${intent}`}
        className="inline-flex min-h-12 items-center justify-center gap-3 rounded-xl border border-navy-900 bg-white px-5 text-sm font-semibold text-navy-900 transition-colors hover:bg-mist-50"
      >
        <span aria-hidden="true" className="text-lg">◉</span>
        Continue with mobile number
      </Link>

      {googleEnabled && (
        <Link
          href={`/auth/google/start?intent=${intent}`}
          className="inline-flex min-h-12 items-center justify-center gap-3 rounded-xl border border-mist-100 bg-white px-5 text-sm font-semibold text-navy-900 shadow-sm transition-colors hover:bg-mist-50"
        >
          <span
            aria-hidden="true"
            className="grid size-6 place-items-center rounded-full border border-mist-100 bg-white text-sm font-bold"
          >
            G
          </span>
          Continue with Google
        </Link>
      )}
    </div>
  )
}

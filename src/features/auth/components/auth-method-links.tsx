import Link from 'next/link'
import { Smartphone } from 'lucide-react'
import { GoogleMark } from './google-mark'

type AuthMethodLinksProps = {
  intent: 'sign-in' | 'sign-up'
  googleEnabled?: boolean
  /**
   * `below` (default): the desktop row under the email form, hidden on phones.
   * `above`: phones only — large full-width Google and mobile-number buttons above the
   * email form, followed by an "or" divider.
   */
  placement?: 'above' | 'below'
}

const phoneButtonClass =
  'inline-flex min-h-13 w-full items-center justify-center gap-3 rounded-full border border-mist-300 bg-white px-4 text-[15px] font-semibold text-navy-950 transition-colors hover:bg-mist-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ocean-500'

export function AuthMethodLinks({ intent, googleEnabled = true, placement = 'below' }: AuthMethodLinksProps) {
  if (placement === 'above') {
    return (
      <div className="mt-6 grid gap-3 md:hidden" data-auth-methods="above">
        {googleEnabled && (
          <Link href={`/auth/google/start?intent=${intent}`} className={phoneButtonClass}>
            <GoogleMark />
            Continue with Google
          </Link>
        )}
        <Link href={`/auth/phone?intent=${intent}`} className={phoneButtonClass}>
          <Smartphone aria-hidden="true" className="size-5 text-ocean-700" />
          Continue with mobile number
        </Link>
        <div className="mt-1 flex items-center gap-3 text-sm text-muted" role="separator" aria-label="or">
          <span aria-hidden="true" className="h-px flex-1 bg-mist-200" />
          <span aria-hidden="true">or</span>
          <span aria-hidden="true" className="h-px flex-1 bg-mist-200" />
        </div>
      </div>
    )
  }

  return (
    <div className="mt-6 grid gap-3 max-md:hidden" data-auth-methods="below">
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
          className="inline-flex min-h-12 items-center justify-center gap-3 rounded-xl border border-mist-200 bg-white px-5 text-sm font-semibold text-navy-900 shadow-sm transition-colors hover:bg-mist-50"
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

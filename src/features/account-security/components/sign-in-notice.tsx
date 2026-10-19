/** Round H (H3): why sign-in is showing (`?notice=`): this device was signed out (or its session ended), or 2FA was reset with a backup code. */
const NOTICES: Record<string, string> = {
  'session-ended': 'You were signed out of this device from your account settings. Sign in again to continue.',
  // Round I (I3): the sliding 30-day session ran out, or a sign-in token was used twice.
  'session-expired': 'You were signed out because Sea N Shore was not opened on this device for 30 days. Sign in again to continue.',
  'session-security': 'For your security we signed this device out: an old sign-in token was used again. Sign in again to continue, and check Settings › Account › Active sessions.',
  'mfa-reset': 'You used a backup code, so two-step verification is now off. Sign in with your email and password, then set up your authenticator app again in Settings › Two-step verification and create new backup codes.',
}

export function signInNoticeMessage(notice: string | string[] | null | undefined) {
  const key = Array.isArray(notice) ? notice[0] : notice
  return key ? NOTICES[key] ?? null : null
}

export function SignInNotice({ notice }: { notice: string | string[] | null | undefined }) {
  const message = signInNoticeMessage(notice)
  if (!message) return null
  return (
    <p role="status" className="mt-4 rounded-lg border border-ocean-100 bg-ocean-50/60 px-4 py-3 text-sm leading-6 text-navy-950">
      {message}
    </p>
  )
}

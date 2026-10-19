import type { Metadata } from 'next'
import { cookies } from 'next/headers'
import { AuthShell } from '@/features/auth/components/auth-shell'
import { AppHandoffConfirmForm } from '@/features/auth/components/app-handoff-confirm-form'
import { APP_HANDOFF_CONFIRM_COOKIE, parseHandoffCookie } from '@/features/auth/app-handoff'

export const metadata: Metadata = { title: 'Finish signing in on the app', robots: { index: false, follow: false } }
export const dynamic = 'force-dynamic'

/** Round I (I3): where a Google sign-in started in the iPhone Home Screen app lands in Safari (see app-handoff). */
export default async function AppHandoffPage() {
  const pending = Boolean(parseHandoffCookie((await cookies()).get(APP_HANDOFF_CONFIRM_COOKIE)?.value))
  return (
    <AuthShell>
      <h1 className="mt-6 font-heading text-2xl font-bold text-navy-950">Finish signing in on the app</h1>
      {pending ? (
        <AppHandoffConfirmForm />
      ) : (
        <p role="status" className="mt-4 leading-7 text-muted">
          There is no sign-in waiting here. Open the Sea N Shore app on your Home Screen and start again, or sign in there with your email.
        </p>
      )}
    </AuthShell>
  )
}

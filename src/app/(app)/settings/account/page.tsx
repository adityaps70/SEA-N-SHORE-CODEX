import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, KeyRound, LifeBuoy, Mail, MonitorSmartphone } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { backLinkClass } from '@/components/ui/interactive-styles'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { getCurrentMfaStatus } from '@/features/auth/mfa-status'
import { createBackupCodeRepository } from '@/features/account-security/backup-codes'
import { BackupCodesPanel } from '@/features/account-security/components/backup-codes-panel'
import { ChangeEmailForm } from '@/features/account-security/components/change-email-form'
import { ChangePasswordForm } from '@/features/account-security/components/change-password-form'
import { SessionsList } from '@/features/account-security/components/sessions-list'
import { accountCardClass } from '@/features/account-security/components/styles'
import { accountQuery } from '@/features/account-security/runtime'
import { createdLabel, sessionViews } from '@/features/account-security/session-labels'
import { currentSessionId, sessionRepository } from '@/features/account-security/session-runtime'

export const metadata: Metadata = { title: 'Account · Settings' }
export const dynamic = 'force-dynamic'

function SectionHeading({ id, icon: Icon, title, description }: { id: string; icon: typeof KeyRound; title: string; description: string }) {
  return (
    <div className="flex gap-3">
      <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-ocean-50 text-ocean-700">
        <Icon aria-hidden="true" className="size-5" />
      </span>
      <div>
        <h2 id={id} className="text-lg font-semibold text-navy-950">{title}</h2>
        <p className="mt-1 text-sm leading-6 text-muted">{description}</p>
      </div>
    </div>
  )
}

/**
 * Round H (H3): Settings › Account. Change password (signs out the other devices), change email (verified first,
 * old address told), active sessions with per-device sign-out, and 2FA backup codes.
 */
export default async function AccountSettingsPage() {
  const user = await requireAwsUser()
  const [status, sessions, thisSession, backup] = await Promise.all([
    getCurrentMfaStatus().catch(() => null),
    sessionRepository.listActive(user.id).catch(() => []),
    currentSessionId(user.id).catch(() => null),
    createBackupCodeRepository({ query: accountQuery }).status(user.id).catch(() => ({ remaining: 0, createdAt: null })),
  ])
  const kind = status?.kind ?? null
  const email = status?.email ?? user.email
  const passwordAccount = kind === 'eligible'
  const emailUnavailable = kind === 'federated'
    ? 'You sign in with Google, so your email comes from your Google account. Change it there.'
    : kind === 'phone'
      ? 'Sign in with your email and password to change your email address.'
      : kind === null
        ? 'We couldn’t load your email settings right now. Refresh the page to try again.'
        : null

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 py-2 max-md:space-y-3 max-md:py-0 sm:py-5">
      <MobilePageBar backHref="/settings" title="Account" />
      <header className="max-md:hidden">
        <Link href="/settings" className={backLinkClass}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Settings
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">Account</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Change your password and email, see where you’re signed in, and keep backup codes for two-step verification.
        </p>
      </header>

      <section aria-labelledby="password-heading" className={accountCardClass}>
        <SectionHeading id="password-heading" icon={KeyRound} title="Password" description="Use at least 12 characters with a lowercase letter, an uppercase letter and a number." />
        {passwordAccount ? (
          <ChangePasswordForm email={email} />
        ) : (
          <p className="mt-4 rounded-xl bg-mist-50 px-3 py-2 text-sm leading-6 text-muted">
            {kind === 'federated'
              ? 'You sign in with Google, so there is no Sea N Shore password to change.'
              : 'We couldn’t load your password settings right now. Refresh the page to try again.'}
          </p>
        )}
      </section>

      <section aria-labelledby="email-heading" className={accountCardClass}>
        <SectionHeading id="email-heading" icon={Mail} title="Email address" description="We check the new address with a code before switching, and let your old address know." />
        <ChangeEmailForm currentEmail={email} unavailableReason={emailUnavailable} />
      </section>

      <section aria-labelledby="sessions-heading" className={accountCardClass}>
        <SectionHeading id="sessions-heading" icon={MonitorSmartphone} title="Active sessions" description="Devices signed in to your account. Locations are approximate." />
        <SessionsList sessions={sessionViews(sessions, thisSession)} />
      </section>

      <section aria-labelledby="backup-codes-heading" className={accountCardClass}>
        <SectionHeading id="backup-codes-heading" icon={LifeBuoy} title="Two-step verification backup codes" description="Use a backup code to sign in if you lose your authenticator app. Using one turns two-step verification off until you set it up again." />
        <BackupCodesPanel
          summary={{
            available: passwordAccount && status?.enabled === true,
            remaining: backup.remaining,
            createdLabel: createdLabel(backup.createdAt),
          }}
        />
      </section>
    </main>
  )
}

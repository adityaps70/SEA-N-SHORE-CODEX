import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, ShieldCheck } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { backLinkClass, primaryButtonClass, secondaryButtonClass, textLinkClass } from '@/components/ui/interactive-styles'
import { adminRepository } from '@/features/admin/repository'
import { signOut } from '@/features/auth/actions'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { TwoStepPanel } from '@/features/auth/components/two-step-panel'
import { canStepUpForAdmin, satisfiesAdminMfa, type CurrentMfaStatus } from '@/features/auth/mfa'
import { hasAdminStepUp } from '@/features/account-security/admin-step-up-runtime'
import { AdminStepUpForm } from '@/features/account-security/components/admin-step-up-form'
import { getCurrentMfaStatus } from '@/features/auth/mfa-status'
import { safeAdminReturnPath } from '@/lib/auth/admin-mfa-paths'

export const metadata: Metadata = { title: 'Two-step verification · Settings' }
export const dynamic = 'force-dynamic'

type SearchParams = Promise<{ required?: string | string[]; next?: string | string[] }>

function single(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value
}

/** What an administrator sent here by the admin MFA gate still has to do. */
function adminNotice(status: CurrentMfaStatus | null): { text: string; signOut: boolean } | null {
  if (!status) return null
  if (status.kind === 'federated') {
    // Hotfix P1: a Google-only account (not linked to an email-and-password account) has no authenticator app.
    return {
      text: 'Admin pages need an authenticator app, and this Google sign-in isn’t linked to your email-and-password account yet. Sign out, then sign in with your email and password. Once the two are linked, you can confirm with your authenticator app here instead.',
      signOut: true,
    }
  }
  if (status.kind !== 'eligible') {
    return {
      text: 'Admin pages need an email and password sign-in protected by an authenticator app. Sign out, then sign in with your email and password.',
      signOut: true,
    }
  }
  if (!status.enabled) {
    return {
      text: 'Admin pages need two-step verification. Set up an authenticator app below to continue to the admin console.',
      signOut: false,
    }
  }
  // Hotfix P1: a Google sign-in with an authenticator app on the account confirms with the step-up form instead.
  return null
}

/** Round 14 (2.11): Settings → Two-step verification (authenticator app). */
export default async function SecuritySettingsPage({ searchParams }: { searchParams: SearchParams }) {
  const user = await requireAwsUser()
  const params = await searchParams
  const [status, isAdministrator] = await Promise.all([
    getCurrentMfaStatus().catch(() => null),
    adminRepository.isPlatformAdministrator(user.id).catch(() => false),
  ])
  const returnTo = safeAdminReturnPath(single(params.next))
  const sentByAdminGate = isAdministrator && single(params.required) === 'admin'
  const gate = sentByAdminGate ? adminNotice(status) : null
  const stepUpPossible = isAdministrator && canStepUpForAdmin(status)
  const steppedUp = stepUpPossible ? await hasAdminStepUp(user.id) : false
  const adminReady = sentByAdminGate && (satisfiesAdminMfa(status) || steppedUp)
  const showStepUp = sentByAdminGate && stepUpPossible && !steppedUp

  return (
    <div className="mx-auto w-full max-w-page-narrow space-y-6 py-2 max-md:space-y-3 max-md:py-0 sm:py-5">
      <MobilePageBar backHref="/settings" title="Two-step verification" />
      <header className="max-md:hidden">
        <Link href="/settings" className={backLinkClass}>
          <ArrowLeft aria-hidden="true" className="size-4" /> Settings
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight text-navy-950">Two-step verification</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted">
          Add a second step to email and password sign-in, so a stolen password alone can’t open your account.
        </p>
      </header>
      <p className="text-sm leading-6 text-muted md:hidden">
        Add a code from an authenticator app to your password sign-in.
      </p>

      {gate ? (
        <div role="status" className="flex gap-3 rounded-xl border border-ocean-100 bg-ocean-50/50 p-4">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-ocean-700" />
          <div className="grid gap-3">
            <p className="text-sm leading-6 text-navy-950">{gate.text}</p>
            {gate.signOut ? (
              <form action={signOut}>
                <button type="submit" className={secondaryButtonClass}>Sign out</button>
              </form>
            ) : null}
          </div>
        </div>
      ) : null}

      {showStepUp ? <AdminStepUpForm returnTo={returnTo} /> : null}

      {adminReady ? (
        <p>
          <Link href={returnTo ?? '/admin'} className={primaryButtonClass}>Continue to the admin console</Link>
        </p>
      ) : null}

      <TwoStepPanel
        status={status ? { kind: status.kind, enabled: status.enabled } : null}
        isAdministrator={isAdministrator}
        returnTo={returnTo}
      />

      {/* Round H (H3): backup codes for a lost authenticator app live with the other account security settings. */}
      <p className="text-sm leading-6 text-muted">
        Lost access to your authenticator app? Keep backup codes in{' '}
        <Link href="/settings/account#backup-codes-heading" className={textLinkClass}>Settings › Account</Link>.
      </p>
    </div>
  )
}

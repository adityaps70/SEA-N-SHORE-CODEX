import type { Metadata } from 'next'
import Link from 'next/link'
import { ArrowLeft, Clock3 } from 'lucide-react'
import { MobilePageBar } from '@/components/navigation/mobile-page-bar'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { OrganizationApplicationForm } from '@/features/organizations/components/organization-application-form'
import { organizationRepository } from '@/features/organizations/repository'
import { safeOrganizationReturnPath, type OrganizationReturnPath } from '@/features/profiles/organization-link'

export const metadata: Metadata = { title: 'Register an organization' }

function backLink(returnTo: OrganizationReturnPath | null) {
  if (returnTo === '/onboarding') return { href: '/onboarding', label: 'Back to setting up your profile' }
  if (returnTo === '/profile/edit') return { href: '/profile/edit#identity', label: 'Back to editing your profile' }
  if (returnTo === '/profile') return { href: '/profile', label: 'Back to your profile' }
  return { href: '/organizations', label: 'Back to Organizations' }
}

/**
 * "I own or manage this organization" from the organization picker: the normal
 * registration flow, verified by Sea N Shore, with the name filled in. After
 * submitting, the member goes back to where they came from and the new
 * organization is linked as their current organization.
 */
export default async function RegisterOrganizationPage({
  searchParams,
}: {
  searchParams: Promise<{ name?: string | string[]; returnTo?: string | string[] }>
}) {
  const params = await searchParams
  const prefillName = (Array.isArray(params.name) ? params.name[0] : params.name)?.trim().slice(0, 160) || undefined
  const returnTo = safeOrganizationReturnPath(params.returnTo)
  const back = backLink(returnTo)
  const user = await requireAwsUser()
  const state = await organizationRepository.getUserOrganizationState(user.id)
  const canRegister = state.kind === 'none' || state.status === 'approved'

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 py-2 sm:py-4 max-md:space-y-3 max-md:py-0">
      <MobilePageBar backHref={back.href} title="Register an organization" />
      <Link href={back.href} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-ocean-700 hover:underline max-md:hidden">
        <ArrowLeft aria-hidden="true" className="size-4" /> {back.label}
      </Link>
      <header className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6 max-md:rounded-none max-md:border-0 max-md:bg-transparent max-md:p-0 max-md:shadow-none">
        <h1 className="text-2xl font-bold tracking-tight text-navy-950 max-md:text-lg">Register {prefillName ?? 'your organization'}</h1>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-muted max-md:text-[13px] max-md:leading-5">
          You told us you own or manage this organization. Sea N Shore verifies every organization before its page can publish jobs, events, courses or updates.
          {returnTo ? ' When you submit, we take you back and link it as your current organization.' : null}
        </p>
      </header>

      {canRegister ? (
        <OrganizationApplicationForm mode="create" prefillName={prefillName} returnTo={returnTo} />
      ) : (
        <section aria-labelledby="register-blocked-heading" className="flex gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sky-950">
          <Clock3 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 id="register-blocked-heading" className="font-bold">
              {state.kind === 'application' && state.status === 'suspended'
                ? 'Registering organizations is paused'
                : `Sea N Shore is still reviewing ${state.kind === 'application' ? state.company.name : 'your organization'}`}
            </h2>
            <p className="mt-1 text-sm leading-6">
              You can register another organization once that review is finished. For now, go back and type the organization name without choosing from the list, or add it as the place you work.
            </p>
            <Link href="/organizations#your-pages" className="mt-2 inline-flex text-sm font-semibold text-ocean-700 hover:underline">See your organization review</Link>
          </div>
        </section>
      )}
    </div>
  )
}

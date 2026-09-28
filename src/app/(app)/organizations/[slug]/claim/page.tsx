import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound, redirect } from 'next/navigation'
import { ArrowLeft, Clock3, ShieldCheck } from 'lucide-react'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { OrganizationApplicationForm } from '@/features/organizations/components/organization-application-form'
import { OrganizationLogo } from '@/features/profiles/components/organization-logo'
import { organizationRepository } from '@/features/organizations/repository'
import { unclaimedOrganizationRepository } from '@/features/organizations/unclaimed-organization-repository'

export const metadata: Metadata = { title: 'Claim an organization page' }

/**
 * "Claim this page" on an unclaimed organization: the same Sea N Shore
 * verification review as registering a new organization.
 */
export default async function ClaimOrganizationPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const user = await requireAwsUser()
  const organization = await unclaimedOrganizationRepository.getClaimableOrganization(slug)
  if (!organization) notFound()
  if (!organization.unclaimed) redirect(`/organizations/${organization.slug}`)

  const state = await organizationRepository.getUserOrganizationState(user.id)
  const ownReview = state.kind === 'application' && state.company.id === organization.id && state.status !== 'approved' ? state : null
  const otherReview = state.kind === 'application' && state.company.id !== organization.id && state.status !== 'approved' ? state : null
  const pageHref = `/organizations/${organization.slug}`

  return (
    <div className="mx-auto w-full max-w-3xl space-y-4 py-2 sm:py-4">
      <Link href={pageHref} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-ocean-700 hover:underline">
        <ArrowLeft aria-hidden="true" className="size-4" /> Back to {organization.name}
      </Link>
      <header className="rounded-2xl border border-mist-100 bg-white p-5 shadow-[var(--shadow-card)] sm:p-6">
        <div className="flex items-center gap-3">
          <OrganizationLogo logoUrl={organization.logoUrl} size="md" />
          <h1 className="min-w-0 text-2xl font-bold tracking-tight text-navy-950">Claim {organization.name}</h1>
        </div>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
          Someone who works here added this page. If you own or manage {organization.name}, tell Sea N Shore who you are. We check every claim the same way we check a new organization. Once it is verified you manage the page, its team and what it publishes.
        </p>
        <p className="mt-2 flex items-start gap-2 text-sm leading-6 text-ink">
          <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ocean-700" />
          Until then the page stays unclaimed: people can still list it, but it cannot post jobs, events, courses or updates.
        </p>
      </header>

      {ownReview ? (
        <section aria-labelledby="claim-status-heading" className="flex gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sky-950">
          <Clock3 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 id="claim-status-heading" className="font-bold">
              {ownReview.status === 'pending' ? 'Sea N Shore is reviewing your claim' : 'Your claim needs attention'}
            </h2>
            <p className="mt-1 text-sm leading-6">
              {ownReview.status === 'pending'
                ? 'You will see the result on your Organizations page.'
                : 'Update the details from your Organizations page and send them again.'}
            </p>
            <Link href="/organizations#update-application" className="mt-2 inline-flex text-sm font-semibold text-ocean-700 hover:underline">Go to your Organizations page</Link>
          </div>
        </section>
      ) : otherReview ? (
        <section aria-labelledby="claim-blocked-heading" className="flex gap-3 rounded-2xl border border-sky-100 bg-sky-50 p-4 text-sky-950">
          <Clock3 aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div>
            <h2 id="claim-blocked-heading" className="font-bold">
              {otherReview.status === 'suspended' ? `Claiming is paused while ${otherReview.company.name} is suspended` : `Sea N Shore is still reviewing ${otherReview.company.name}`}
            </h2>
            <p className="mt-1 text-sm leading-6">You can claim another page once that review is finished.</p>
          </div>
        </section>
      ) : (
        <OrganizationApplicationForm mode="claim" companyId={organization.id} initial={organization.prefill} />
      )}
    </div>
  )
}

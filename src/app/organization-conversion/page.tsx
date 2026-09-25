import { redirect } from 'next/navigation'
import { ArrowLeftRight } from 'lucide-react'
import { Wordmark } from '@/components/brand/wordmark'
import { requireAwsUser } from '@/features/auth/aws-queries'
import { legacyOrganizationConversionRepository } from '@/features/organizations/legacy-conversion-repository'
import { LegacyOrganizationConversionForm } from '@/features/organizations/components/legacy-organization-conversion-form'

export default async function OrganizationConversionPage() {
  const user = await requireAwsUser()
  const conversion = await legacyOrganizationConversionRepository.getConversion(user.id)

  if (!conversion || conversion.status === 'completed') redirect('/home')

  return (
    <main className="min-h-screen bg-[linear-gradient(180deg,var(--mist-50)_0%,white_42%,var(--mist-50)_100%)] px-4 py-5 sm:px-6 sm:py-7">
      <div className="mx-auto max-w-5xl">
        <div className="flex min-h-16 items-center justify-between gap-4 border-b border-mist-100">
          <Wordmark compact />
          <span className="inline-flex items-center gap-2 rounded-full border border-mist-100 bg-white px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[.16em] text-ocean-700 shadow-sm">
            <ArrowLeftRight aria-hidden="true" className="size-3.5" /> Account conversion
          </span>
        </div>

        <header className="max-w-3xl py-8 sm:py-10">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-ocean-700">One-time migration</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-[-.045em] text-navy-950 sm:text-5xl">
            Keep the person and the organization separate.
          </h1>
          <p className="mt-4 text-base leading-7 text-muted sm:text-lg">
            Your old Sea N Shore account was created as an organization-style profile. We are converting it to the new model: one personal account for you, plus a separate organization workspace that you manage.
          </p>
        </header>

        <LegacyOrganizationConversionForm conversion={conversion} />

        <p className="py-6 text-center text-xs leading-5 text-muted">
          Nothing is silently deleted. The old organization profile is preserved in the migration record for audit and recovery purposes.
        </p>
      </div>
    </main>
  )
}
